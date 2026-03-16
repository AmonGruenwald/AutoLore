from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import Book, WikiPage, WikiPageVersion, Series, get_db

router = APIRouter(prefix="/api/wiki", tags=["wiki"])


@router.get("/{book_id}/pages")
def list_wiki_pages(book_id: int, up_to_chapter: int, db: Session = Depends(get_db)):
    """
    Returns all wiki pages that have at least one version visible at up_to_chapter.
    Groups by type for sidebar navigation.
    """
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")

    pages = db.query(WikiPage).filter_by(book_id=book_id).all()

    result = {"summaries": [], "characters": [], "places": [], "events": []}

    for page in pages:
        visible_versions = [v for v in page.versions if v.first_visible_chapter <= up_to_chapter]
        if not visible_versions:
            continue

        page_info = {
            "id": page.id,
            "slug": page.slug,
            "title": page.title,
            "page_type": page.page_type,
            "first_visible_chapter": min(v.first_visible_chapter for v in visible_versions),
            "last_updated_chapter": max(v.first_visible_chapter for v in visible_versions),
        }

        key = page.page_type + "s" if page.page_type != "summary" else "summaries"
        if key in result:
            result[key].append(page_info)

    # Sort summaries by chapter number
    result["summaries"].sort(key=lambda p: p["first_visible_chapter"])
    for key in ("characters", "places", "events"):
        result[key].sort(key=lambda p: p["title"].lower())

    return result


@router.get("/{book_id}/page/{slug}")
def get_wiki_page(book_id: int, slug: str, up_to_chapter: int, db: Session = Depends(get_db)):
    """
    Returns the latest version of a wiki page visible at up_to_chapter.
    """
    page = db.query(WikiPage).filter_by(book_id=book_id, slug=slug).first()
    if not page:
        raise HTTPException(404, "Wiki page not found")

    visible_versions = [v for v in page.versions if v.first_visible_chapter <= up_to_chapter]
    if not visible_versions:
        raise HTTPException(404, "No content visible at this chapter")

    latest = max(visible_versions, key=lambda v: v.first_visible_chapter)

    # Resolve outgoing links — only include those that are visible
    resolved_links = []
    for link in (latest.outgoing_links or []):
        target = db.query(WikiPage).filter_by(book_id=book_id, slug=link["slug"]).first()
        if target:
            has_visible = any(v.first_visible_chapter <= up_to_chapter for v in target.versions)
            if has_visible:
                resolved_links.append({**link, "exists": True})
            else:
                resolved_links.append({**link, "exists": False})
        else:
            resolved_links.append({**link, "exists": False})

    # Backlinks: pages that link to this page
    backlinks = _find_backlinks(db, book_id, slug, up_to_chapter)

    return {
        "id": page.id,
        "slug": page.slug,
        "title": page.title,
        "page_type": page.page_type,
        "content_markdown": latest.content_markdown,
        "first_visible_chapter": min(v.first_visible_chapter for v in visible_versions),
        "last_updated_chapter": latest.first_visible_chapter,
        "outgoing_links": resolved_links,
        "backlinks": backlinks,
        "version_history": [
            {"chapter": v.first_visible_chapter} for v in visible_versions
        ],
    }


def _find_backlinks(db: Session, book_id: int, target_slug: str, up_to_chapter: int) -> list[dict]:
    all_pages = db.query(WikiPage).filter_by(book_id=book_id).all()
    backlinks = []
    for page in all_pages:
        visible_versions = [v for v in page.versions if v.first_visible_chapter <= up_to_chapter]
        if not visible_versions:
            continue
        latest = max(visible_versions, key=lambda v: v.first_visible_chapter)
        for link in (latest.outgoing_links or []):
            if link["slug"] == target_slug:
                backlinks.append({
                    "slug": page.slug,
                    "title": page.title,
                    "page_type": page.page_type,
                })
                break
    return backlinks


# --- Series wiki ---

@router.get("/series/{series_id}/pages")
def list_series_wiki_pages(series_id: int, up_to_global_chapter: int, db: Session = Depends(get_db)):
    """
    Series mode: merges wiki pages across all books in order.
    up_to_global_chapter counts chapters across the whole series.
    """
    series = db.query(Series).filter_by(id=series_id).first()
    if not series:
        raise HTTPException(404, "Series not found")

    books = (
        db.query(Book)
        .filter_by(series_id=series_id)
        .order_by(Book.series_order)
        .all()
    )

    # Build global chapter offset for each book
    offset = 0
    book_offsets = {}
    for book in books:
        book_offsets[book.id] = offset
        offset += book.total_chapters

    result = {"summaries": [], "characters": [], "places": [], "events": []}

    for book in books:
        book_offset = book_offsets[book.id]
        # How many chapters of this book are visible?
        local_chapters = max(0, up_to_global_chapter - book_offset)
        if local_chapters <= 0:
            continue

        pages = db.query(WikiPage).filter_by(book_id=book.id).all()
        for page in pages:
            visible_versions = [v for v in page.versions if v.first_visible_chapter <= local_chapters]
            if not visible_versions:
                continue

            key = page.page_type + "s" if page.page_type != "summary" else "summaries"
            if key in result:
                result[key].append({
                    "id": page.id,
                    "slug": page.slug,
                    "title": page.title,
                    "page_type": page.page_type,
                    "book_id": book.id,
                    "book_title": book.title,
                    "first_visible_chapter": book_offset + min(v.first_visible_chapter for v in visible_versions),
                    "last_updated_chapter": book_offset + max(v.first_visible_chapter for v in visible_versions),
                })

    result["summaries"].sort(key=lambda p: p["first_visible_chapter"])
    for key in ("characters", "places", "events"):
        result[key].sort(key=lambda p: p["title"].lower())

    return result
