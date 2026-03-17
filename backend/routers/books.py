import asyncio
import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel
from database import Book, Chapter, Series, Setting, get_db
from epub_parser import parse_epub
from duplicate_detector import compute_hash, find_duplicate
from wiki_builder import build_wiki_for_book
from database import SessionLocal

router = APIRouter(prefix="/api/books", tags=["books"])

EPUB_STORAGE = os.environ.get("EPUB_STORAGE", "./epubs")
os.makedirs(EPUB_STORAGE, exist_ok=True)


def _db_factory():
    return SessionLocal()


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
    # Remove stored epub file
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

    # Parse epub first to get metadata
    try:
        parsed = parse_epub(file_bytes)
    except Exception as e:
        raise HTTPException(400, f"Failed to parse EPUB: {e}")

    # Get API key for duplicate detection
    api_key_setting = db.query(Setting).filter_by(key="openrouter_api_key").first()
    model_setting = db.query(Setting).filter_by(key="openrouter_model").first()
    api_key = api_key_setting.value if api_key_setting else ""
    model = model_setting.value if model_setting else "mistralai/mistral-7b-instruct"

    excerpt = parsed.chapters[0].raw_text[:500] if parsed.chapters else ""

    # Duplicate detection (only if API key is configured)
    duplicate_info = None
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

    # Store epub file
    epub_path = os.path.join(EPUB_STORAGE, f"{content_hash}.epub")
    with open(epub_path, "wb") as f:
        f.write(file_bytes)

    # Save to DB
    book = Book(
        title=parsed.title,
        author=parsed.author,
        filename=file.filename,
        content_hash=content_hash,
        total_chapters=len(parsed.chapters),
        generation_status="pending",
    )
    db.add(book)
    db.flush()

    for ch in parsed.chapters:
        chapter = Chapter(
            book_id=book.id,
            number=ch.number,
            title=ch.title,
            raw_text=ch.raw_text,
        )
        db.add(chapter)

    db.commit()
    book_id = book.id

    # Kick off background generation
    if api_key:
        background_tasks.add_task(_run_generation, book_id)
    else:
        book.generation_status = "pending"
        db.commit()

    return {"status": "imported", "book_id": book_id, "title": parsed.title}


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

    file_bytes = bytes.fromhex(file_bytes_hex)
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
        filename=original_filename,
        content_hash=content_hash,
        total_chapters=len(parsed.chapters),
        generation_status="pending",
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
    book_id = book.id

    api_key_setting = db.query(Setting).filter_by(key="openrouter_api_key").first()
    if api_key_setting and api_key_setting.value:
        background_tasks.add_task(_run_generation, book_id)

    return {"status": "imported", "book_id": book_id, "title": parsed.title}


@router.post("/{book_id}/regenerate")
async def regenerate_wiki(
    book_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")

    api_key_setting = db.query(Setting).filter_by(key="openrouter_api_key").first()
    if not api_key_setting or not api_key_setting.value:
        raise HTTPException(400, "OpenRouter API key not configured")

    # Clear existing wiki data
    from database import WikiPage
    db.query(WikiPage).filter_by(book_id=book_id).delete()
    book.generation_status = "pending"
    book.generation_progress = 0
    book.generation_error = None
    db.commit()

    background_tasks.add_task(_run_generation, book_id)
    return {"ok": True}


def _run_generation(book_id: int):
    asyncio.run(build_wiki_for_book(book_id, _db_factory))


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
    # Remove old associations
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
        "created_at": book.created_at.isoformat() if book.created_at else None,
    }


def _book_detail(book: Book) -> dict:
    d = _book_summary(book)
    d["generation_error"] = book.generation_error
    d["chapters"] = [
        {"number": c.number, "title": c.title}
        for c in sorted(book.chapters, key=lambda c: c.number)
    ]
    return d
