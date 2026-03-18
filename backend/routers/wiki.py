from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database import Book, WikiPage, WikiPageVersion, Series, Setting, get_db
import ai_service

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


@router.delete("/{book_id}/page/{slug}")
def delete_wiki_page(book_id: int, slug: str, db: Session = Depends(get_db)):
    """Permanently delete a wiki page and all its versions."""
    page = db.query(WikiPage).filter_by(book_id=book_id, slug=slug).first()
    if not page:
        raise HTTPException(404, "Wiki page not found")
    db.delete(page)
    db.commit()
    return {"ok": True}


class MergePageBody(BaseModel):
    merge_with_slug: str


@router.post("/{book_id}/page/{slug}/merge")
async def merge_wiki_page(
    book_id: int,
    slug: str,
    body: MergePageBody,
    db: Session = Depends(get_db),
):
    """
    Merge two wiki pages into one using AI.
    The source page (slug) is updated with the combined content; the
    target page (merge_with_slug) is deleted.  Returns the updated page.
    """
    from ai_service import merge_wiki_pages as ai_merge
    from wiki_builder import resolve_links

    if slug == body.merge_with_slug:
        raise HTTPException(400, "Cannot merge a page with itself")

    page_a = db.query(WikiPage).filter_by(book_id=book_id, slug=slug).first()
    page_b = db.query(WikiPage).filter_by(book_id=book_id, slug=body.merge_with_slug).first()
    if not page_a or not page_b:
        raise HTTPException(404, "Page not found")
    if page_a.page_type != page_b.page_type:
        raise HTTPException(400, "Can only merge pages of the same type")

    api_key_row = db.query(Setting).filter_by(key="openrouter_api_key").first()
    model_row   = db.query(Setting).filter_by(key="openrouter_model").first()
    api_key = api_key_row.value if api_key_row else ""
    model   = model_row.value if model_row else "mistralai/mistral-7b-instruct"
    if not api_key:
        raise HTTPException(400, "OpenRouter API key not configured")

    content_a = _latest_content(page_a)
    content_b = _latest_content(page_b)

    fvc = min(
        (min(v.first_visible_chapter for v in page_a.versions) if page_a.versions else 1),
        (min(v.first_visible_chapter for v in page_b.versions) if page_b.versions else 1),
    )
    lvc = max(
        (max(v.first_visible_chapter for v in page_a.versions) if page_a.versions else 1),
        (max(v.first_visible_chapter for v in page_b.versions) if page_b.versions else 1),
    )

    merged = await ai_merge(
        api_key, model,
        page_a.title, page_a.page_type, content_a,
        page_b.title, content_b,
    )

    # Replace all versions of page_a with a single merged version
    for v in list(page_a.versions):
        db.delete(v)
    db.flush()

    links = resolve_links(merged["content"])
    db.add(WikiPageVersion(
        page_id=page_a.id,
        first_visible_chapter=fvc,
        content_markdown=merged["content"],
        outgoing_links=links,
    ))
    page_a.title = merged["title"]

    # Delete the absorbed page
    db.delete(page_b)
    db.commit()

    # Return full page detail so the frontend can display it immediately
    db.refresh(page_a)
    return {
        "slug": page_a.slug,
        "title": page_a.title,
        "page_type": page_a.page_type,
        "content_markdown": merged["content"],
        "first_visible_chapter": fvc,
        "last_updated_chapter": lvc,
        "outgoing_links": links,
        "backlinks": [],
        "version_history": [{"chapter": fvc}],
    }


class UpdatePageBody(BaseModel):
    title: str
    content: str
    edit_chapter: int  # the chapter the user is viewing (determines which version is being edited)


@router.put("/{book_id}/page/{slug}")
async def update_wiki_page(
    book_id: int,
    slug: str,
    body: UpdatePageBody,
    db: Session = Depends(get_db),
):
    """
    Manually edit a wiki page's title and content.
    Slugs are always derived from the page title; a title change renames the
    slug and rewrites every reference to it across the entire book.
    """
    from ai_service import propagate_wiki_edit, _slugify
    from wiki_builder import resolve_links
    from sqlalchemy.orm.attributes import flag_modified

    page = db.query(WikiPage).filter_by(book_id=book_id, slug=slug).first()
    if not page:
        raise HTTPException(404, "Wiki page not found")

    # Versions visible at edit_chapter, sorted by chapter
    visible = sorted(
        [v for v in page.versions if v.first_visible_chapter <= body.edit_chapter],
        key=lambda v: v.first_visible_chapter,
    )
    if not visible:
        raise HTTPException(404, "No version visible at this chapter")

    target = visible[-1]
    target_chapter = target.first_visible_chapter  # save before potential expiry
    old_content = target.content_markdown
    old_slug = page.slug
    old_title = page.title

    # Apply user's edit to the target version
    new_links = resolve_links(body.content)
    target.content_markdown = body.content
    target.outgoing_links = new_links
    flag_modified(target, "outgoing_links")
    # Enforce title uniqueness within the book (excluding this page)
    if body.title != old_title:
        conflict = db.query(WikiPage).filter(
            WikiPage.book_id == book_id,
            WikiPage.title == body.title,
            WikiPage.id != page.id,
        ).first()
        if conflict:
            raise HTTPException(400, f"A page with the title '{body.title}' already exists in this book")

    page.title = body.title

    # Slug is always derived from title — keep them in sync
    new_slug = _slugify(body.title)
    if new_slug != old_slug:
        page.slug = new_slug
        type_cap = page.page_type.capitalize()
        old_link_text = f"[[{type_cap}:{old_title}]]"
        new_link_text = f"[[{type_cap}:{body.title}]]"

        # Rewrite every version in the book that references the old slug/title
        other_versions = (
            db.query(WikiPageVersion)
            .join(WikiPage, WikiPageVersion.page_id == WikiPage.id)
            .filter(WikiPage.book_id == book_id, WikiPage.id != page.id)
            .all()
        )
        for v in other_versions:
            dirty = False
            if v.content_markdown and old_link_text in v.content_markdown:
                v.content_markdown = v.content_markdown.replace(old_link_text, new_link_text)
                # Recompute links from the updated markdown so slugs stay in sync
                v.outgoing_links = resolve_links(v.content_markdown)
                dirty = True
            elif any(lk.get("slug") == old_slug for lk in (v.outgoing_links or [])):
                # outgoing_links references old slug but markdown was already up-to-date
                v.outgoing_links = [
                    {**lk, "slug": new_slug, "text": body.title}
                    if lk.get("slug") == old_slug else lk
                    for lk in v.outgoing_links
                ]
                dirty = True
            if dirty:
                flag_modified(v, "outgoing_links")

    # Future versions — propagate the user's changes using AI
    future_versions = sorted(
        [v for v in page.versions if v.first_visible_chapter > target_chapter],
        key=lambda v: v.first_visible_chapter,
    )

    if future_versions:
        api_key_row = db.query(Setting).filter_by(key="openrouter_api_key").first()
        model_row   = db.query(Setting).filter_by(key="openrouter_model").first()
        api_key = api_key_row.value if api_key_row else ""
        model   = model_row.value if model_row else "mistralai/mistral-7b-instruct"

        if api_key:
            try:
                current_old = old_content
                current_new = body.content
                for fv in future_versions:
                    old_fv_content = fv.content_markdown
                    result = await propagate_wiki_edit(
                        api_key, model,
                        page.page_type,
                        current_old, current_new,
                        fv.content_markdown,
                    )
                    fv.content_markdown = result["content"]
                    fv.outgoing_links = resolve_links(result["content"])
                    flag_modified(fv, "outgoing_links")
                    # Cascade: next iteration diffs old → new of this version
                    current_old = old_fv_content
                    current_new = result["content"]
            except Exception:
                pass  # AI propagation failed; the target edit is still committed below

    db.commit()
    db.refresh(page)

    all_versions = sorted(page.versions, key=lambda v: v.first_visible_chapter)
    fvc = all_versions[0].first_visible_chapter

    return {
        "id": page.id,
        "slug": page.slug,
        "title": page.title,
        "page_type": page.page_type,
        "content_markdown": body.content,
        "first_visible_chapter": fvc,
        "last_updated_chapter": target_chapter,
        "outgoing_links": new_links,
        "backlinks": _find_backlinks(db, book_id, page.slug, body.edit_chapter),
        "version_history": [{"chapter": v.first_visible_chapter} for v in all_versions],
    }


def _latest_content(page: WikiPage) -> str:
    if not page.versions:
        return ""
    return max(page.versions, key=lambda v: v.first_visible_chapter).content_markdown


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


# ---------------------------------------------------------------------------
# Q&A
# ---------------------------------------------------------------------------

class AskRequest(BaseModel):
    question: str
    up_to_chapter: int
    conversation_history: list[dict] = []


@router.post("/{book_id}/ask")
async def ask_question(book_id: int, req: AskRequest, db: Session = Depends(get_db)):
    """
    Answer a reader question using only wiki pages visible at up_to_chapter (RAG).
    Returns the AI answer and the source pages that were used as context.
    """
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")

    api_key_row = db.query(Setting).filter_by(key="openrouter_api_key").first()
    model_row = db.query(Setting).filter_by(key="openrouter_model").first()
    api_key = api_key_row.value if api_key_row else ""
    model = model_row.value if model_row else "mistralai/mistral-7b-instruct"

    if not api_key:
        raise HTTPException(400, "No API key configured")

    # Collect all pages visible at this chapter
    candidates = []
    for page in db.query(WikiPage).filter_by(book_id=book_id).all():
        visible = [v for v in page.versions if v.first_visible_chapter <= req.up_to_chapter]
        if not visible:
            continue
        latest = max(visible, key=lambda v: v.first_visible_chapter)
        candidates.append({
            "title": page.title,
            "type": page.page_type,
            "slug": page.slug,
            "content": latest.content_markdown,
        })

    # Rank by relevance to the question; take top 8 with score > 0
    scored = sorted(
        candidates,
        key=lambda c: ai_service.score_page_relevance(req.question, c["title"], c["content"]),
        reverse=True,
    )
    top = [c for c in scored[:8] if ai_service.score_page_relevance(req.question, c["title"], c["content"]) > 0]
    # Fallback: always send at least 3 pages so the model has some context
    if not top:
        top = scored[:3]

    answer = await ai_service.answer_question(
        api_key=api_key,
        model=model,
        question=req.question,
        context_pages=top,
        chapter_number=req.up_to_chapter,
        conversation_history=req.conversation_history or None,
    )

    sources = [{"title": p["title"], "slug": p["slug"], "page_type": p["type"]} for p in top]
    return {"answer": answer, "sources": sources}
