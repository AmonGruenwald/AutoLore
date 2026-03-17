import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel
from database import Book, Chapter, Series, Setting, WikiPage, get_db, SessionLocal
from epub_parser import parse_epub
from duplicate_detector import compute_hash, find_duplicate
from wiki_builder import build_wiki_for_book, generate_previews_for_book

router = APIRouter(prefix="/api/books", tags=["books"])

EPUB_STORAGE = os.environ.get("EPUB_STORAGE", "./epubs")
os.makedirs(EPUB_STORAGE, exist_ok=True)


def _db_factory():
    return SessionLocal()


def _get_api_settings(db: Session) -> tuple[str, str]:
    """Return (api_key, model) from settings, with defaults."""
    api_key_setting = db.query(Setting).filter_by(key="openrouter_api_key").first()
    model_setting = db.query(Setting).filter_by(key="openrouter_model").first()
    api_key = api_key_setting.value if api_key_setting else ""
    model = model_setting.value if model_setting else "mistralai/mistral-7b-instruct"
    return api_key, model


def _import_book(db: Session, file_bytes: bytes, filename: str) -> Book:
    """Parse epub, persist to DB, and return the new Book (not yet committed)."""
    content_hash = compute_hash(file_bytes)

    try:
        parsed = parse_epub(file_bytes)
    except Exception as e:
        raise HTTPException(400, f"Failed to parse EPUB: {e}")

    epub_path = os.path.join(EPUB_STORAGE, f"{content_hash}.epub")
    with open(epub_path, "wb") as f:
        f.write(file_bytes)

    book = Book(
        title=parsed.title,
        author=parsed.author,
        filename=filename,
        content_hash=content_hash,
        total_chapters=len(parsed.chapters),
        generation_status="selecting",
    )
    db.add(book)
    db.flush()

    for ch in parsed.chapters:
        db.add(Chapter(
            book_id=book.id,
            number=ch.number,
            title=ch.title,
            raw_text=ch.raw_text,
        ))

    db.commit()
    return book


@router.get("/")
def list_books(db: Session = Depends(get_db)):
    books = db.query(Book).order_by(Book.created_at.desc()).all()
    return [_book_summary(b) for b in books]


@router.get("/{book_id}")
def get_book(book_id: int, db: Session = Depends(get_db)):
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    return _book_detail(book)


@router.delete("/{book_id}")
def delete_book(book_id: int, db: Session = Depends(get_db)):
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    epub_path = os.path.join(EPUB_STORAGE, f"{book.content_hash}.epub")
    if os.path.exists(epub_path):
        os.remove(epub_path)
    db.delete(book)
    db.commit()
    return {"ok": True}


@router.post("/upload")
async def upload_book(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename.endswith(".epub"):
        raise HTTPException(400, "Only .epub files are supported")

    file_bytes = await file.read()
    content_hash = compute_hash(file_bytes)

    try:
        parsed = parse_epub(file_bytes)
    except Exception as e:
        raise HTTPException(400, f"Failed to parse EPUB: {e}")

    api_key, model = _get_api_settings(db)
    excerpt = parsed.chapters[0].raw_text[:500] if parsed.chapters else ""

    if api_key:
        duplicate_info = await find_duplicate(
            db, content_hash, parsed.title, parsed.author, excerpt, api_key, model
        )
        if duplicate_info:
            return {
                "status": "duplicate_found",
                "existing_book_id": duplicate_info["book"].id,
                "existing_title": duplicate_info["book"].title,
                "confidence": duplicate_info["confidence"],
                "reasoning": duplicate_info["reasoning"],
                "parsed_title": parsed.title,
                "parsed_author": parsed.author,
            }

    book = _import_book(db, file_bytes, file.filename)

    if api_key:
        background_tasks.add_task(_run_previews, book.id)

    return {"status": "imported", "book_id": book.id, "title": book.title}


@router.post("/upload/confirm-duplicate")
async def confirm_duplicate_upload(
    background_tasks: BackgroundTasks,
    body: dict,
    db: Session = Depends(get_db),
):
    """Force import even though a duplicate was detected."""
    file_bytes_hex = body.get("file_bytes_hex")
    original_filename = body.get("filename", "book.epub")

    if not file_bytes_hex:
        raise HTTPException(400, "file_bytes_hex required")

    book = _import_book(db, bytes.fromhex(file_bytes_hex), original_filename)

    api_key, _ = _get_api_settings(db)
    if api_key:
        background_tasks.add_task(_run_previews, book.id)

    return {"status": "imported", "book_id": book.id, "title": book.title}


@router.post("/{book_id}/regenerate")
async def regenerate_wiki(
    book_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")

    api_key, _ = _get_api_settings(db)
    if not api_key:
        raise HTTPException(400, "OpenRouter API key not configured")

    # Delete all generated wiki content
    db.query(WikiPage).filter_by(book_id=book_id).delete()

    # Restore chapter data to original state from the stored EPUB.
    # confirmChapterSelection permanently mutates raw_text (merges) and title
    # ("Ch1 / Ch2"), so we must re-parse to undo those changes.
    epub_path = os.path.join(EPUB_STORAGE, f"{book.content_hash}.epub")
    if os.path.exists(epub_path):
        with open(epub_path, "rb") as f:
            file_bytes = f.read()
        try:
            parsed = parse_epub(file_bytes)
            orig_by_number = {ch.number: ch for ch in parsed.chapters}
            for ch in db.query(Chapter).filter_by(book_id=book_id).all():
                orig = orig_by_number.get(ch.number)
                if orig:
                    ch.title = orig.title
                    ch.raw_text = orig.raw_text
            book.total_chapters = len(parsed.chapters)
        except Exception:
            pass  # If re-parse fails, fall back to just resetting metadata
    else:
        # EPUB no longer on disk — reset to actual chapter count from DB
        book.total_chapters = db.query(Chapter).filter_by(book_id=book_id).count()

    # Reset all selection/generation metadata
    db.query(Chapter).filter_by(book_id=book_id).update({
        "is_story_chapter": None,
        "clean_title": None,
        "one_sentence_summary": None,
    })
    book.generation_status = "selecting"
    book.generation_progress = 0
    book.generation_error = None
    book.generation_step = None
    db.commit()

    if api_key:
        background_tasks.add_task(_run_previews, book_id)
    return {"ok": True}


class StopChapterBody(BaseModel):
    stop_chapter: int | None  # 1-based story-chapter index; None clears the stop point


@router.patch("/{book_id}/stop-chapter")
def set_stop_chapter(
    book_id: int,
    body: StopChapterBody,
    db: Session = Depends(get_db),
):
    """Set (or clear) the chapter at which processing should pause."""
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    book.stop_chapter = body.stop_chapter
    db.commit()
    return {"ok": True}


@router.get("/{book_id}/chapters")
def list_chapters(book_id: int, db: Session = Depends(get_db)):
    """Return all chapters (with one-sentence summaries) for the chapter selection UI."""
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    chapters = (
        db.query(Chapter)
        .filter_by(book_id=book_id)
        .order_by(Chapter.number)
        .all()
    )
    return {
        "book_id": book_id,
        "title": book.title,
        "generation_step": book.generation_step,
        "chapters": [
            {
                "id": c.id,
                "number": c.number,
                "title": c.title,
                "one_sentence_summary": c.one_sentence_summary,
            }
            for c in chapters
        ],
    }


class ChapterSelectionItem(BaseModel):
    id: int
    include: bool


class ChapterRenameItem(BaseModel):
    id: int
    title: str


class ConfirmSelectionBody(BaseModel):
    selections: list[ChapterSelectionItem]
    merges: list[list[int]] = []   # each sub-list is a pair [id_a, id_b] to merge
    renames: list[ChapterRenameItem] = []  # user-edited chapter titles


@router.post("/{book_id}/confirm-selection")
async def confirm_selection(
    book_id: int,
    body: ConfirmSelectionBody,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Save the user's chapter selection (and optional merges), then start wiki generation.
    Merges: for each pair [a, b], chapter b's text is appended to chapter a's raw_text
    and chapter b is excluded.
    """
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    if book.generation_status != "selecting":
        raise HTTPException(400, f"Book is not in selection state (status: {book.generation_status})")

    api_key, _ = _get_api_settings(db)
    if not api_key:
        raise HTTPException(400, "OpenRouter API key not configured")

    # Apply merges first: append second chapter's text to first, then exclude second
    merged_out: set[int] = set()
    for pair in body.merges:
        if len(pair) != 2:
            continue
        id_a, id_b = pair
        ch_a = db.query(Chapter).filter_by(id=id_a, book_id=book_id).first()
        ch_b = db.query(Chapter).filter_by(id=id_b, book_id=book_id).first()
        if ch_a and ch_b:
            ch_a.raw_text = ch_a.raw_text.rstrip() + "\n\n" + ch_b.raw_text.lstrip()
            ch_a.title = f"{ch_a.title} / {ch_b.title}"
            merged_out.add(id_b)

    # Apply include/exclude flags
    include_ids = {s.id for s in body.selections if s.include} - merged_out
    for sel in body.selections:
        ch = db.query(Chapter).filter_by(id=sel.id, book_id=book_id).first()
        if ch:
            ch.is_story_chapter = (sel.id in include_ids)

    # Force-exclude merged-out chapters
    for ch_id in merged_out:
        ch = db.query(Chapter).filter_by(id=ch_id, book_id=book_id).first()
        if ch:
            ch.is_story_chapter = False

    # Apply user renames (stored as clean_title so the original title is preserved)
    for rename in body.renames:
        ch = db.query(Chapter).filter_by(id=rename.id, book_id=book_id).first()
        if ch and rename.title.strip():
            ch.clean_title = rename.title.strip()

    story_count = sum(1 for s in body.selections if s.id in include_ids)
    book.total_chapters = story_count
    book.generation_status = "pending"
    book.generation_step = None
    db.commit()

    background_tasks.add_task(_run_generation, book_id)
    return {"ok": True}


@router.post("/{book_id}/continue")
async def continue_processing(
    book_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Process the next chapter for a book that is in 'waiting' state."""
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    if book.generation_status not in ("waiting", "pending", "error"):
        raise HTTPException(400, f"Book is not waiting for continuation (status: {book.generation_status})")

    api_key, _ = _get_api_settings(db)
    if not api_key:
        raise HTTPException(400, "OpenRouter API key not configured")

    background_tasks.add_task(_run_generation, book_id)
    return {"ok": True}


async def _run_previews(book_id: int):
    await generate_previews_for_book(book_id, _db_factory)


async def _run_generation(book_id: int):
    await build_wiki_for_book(book_id, _db_factory)


# --- Series endpoints ---

class SeriesCreate(BaseModel):
    name: str
    book_ids: list[int]


@router.get("/series/all")
def list_series(db: Session = Depends(get_db)):
    series = db.query(Series).all()
    return [{"id": s.id, "name": s.name, "book_order": s.book_order} for s in series]


@router.post("/series")
def create_series(body: SeriesCreate, db: Session = Depends(get_db)):
    series = Series(name=body.name, book_order=body.book_ids)
    db.add(series)
    db.flush()
    for i, book_id in enumerate(body.book_ids):
        book = db.query(Book).filter_by(id=book_id).first()
        if book:
            book.series_id = series.id
            book.series_order = i
    db.commit()
    return {"id": series.id, "name": series.name}


@router.put("/series/{series_id}")
def update_series(series_id: int, body: SeriesCreate, db: Session = Depends(get_db)):
    series = db.query(Series).filter_by(id=series_id).first()
    if not series:
        raise HTTPException(404, "Series not found")
    old_books = db.query(Book).filter_by(series_id=series_id).all()
    for b in old_books:
        b.series_id = None
        b.series_order = None
    series.name = body.name
    series.book_order = body.book_ids
    for i, book_id in enumerate(body.book_ids):
        book = db.query(Book).filter_by(id=book_id).first()
        if book:
            book.series_id = series_id
            book.series_order = i
    db.commit()
    return {"ok": True}


@router.delete("/series/{series_id}")
def delete_series(series_id: int, db: Session = Depends(get_db)):
    series = db.query(Series).filter_by(id=series_id).first()
    if not series:
        raise HTTPException(404, "Series not found")
    books = db.query(Book).filter_by(series_id=series_id).all()
    for b in books:
        b.series_id = None
        b.series_order = None
    db.delete(series)
    db.commit()
    return {"ok": True}


# --- Helpers ---

def _book_summary(book: Book) -> dict:
    return {
        "id": book.id,
        "title": book.title,
        "author": book.author,
        "total_chapters": book.total_chapters,
        "generation_status": book.generation_status,
        "generation_progress": book.generation_progress,
        "generation_step": book.generation_step,
        "series_id": book.series_id,
        "series_order": book.series_order,
        "stop_chapter": book.stop_chapter,
        "created_at": book.created_at.isoformat() if book.created_at else None,
    }


def _book_detail(book: Book) -> dict:
    d = _book_summary(book)
    d["generation_error"] = book.generation_error
    story_chapters = sorted(
        [c for c in book.chapters if c.is_story_chapter is True],
        key=lambda c: c.number,
    )
    d["chapters"] = [
        {"number": i + 1, "title": c.clean_title or c.title}
        for i, c in enumerate(story_chapters)
    ]
    return d
