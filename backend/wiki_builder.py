"""
Wiki generation pipeline.

Each call to build_wiki_for_book processes exactly ONE chapter, then
sets generation_status to "waiting" (or "done" when all chapters are
complete).  The caller is responsible for invoking it again for each
subsequent chapter — either via the /continue endpoint (manual) or
automatically from the frontend's auto-process toggle.
"""
import asyncio
import re
from sqlalchemy.orm import Session
from database import Book, Chapter, WikiPage, WikiPageVersion, Setting
from ai_service import generate_chapter_previews, generate_chapter_summary, generate_entity_page, resolve_entity_aliases, _slugify


async def _get_settings(db: Session) -> tuple[str, str]:
    api_key = db.query(Setting).filter_by(key="openrouter_api_key").first()
    model = db.query(Setting).filter_by(key="openrouter_model").first()
    if not api_key or not api_key.value:
        raise ValueError("OpenRouter API key not configured")
    return api_key.value, (model.value if model else "mistralai/mistral-7b-instruct")


def resolve_links(markdown: str) -> list[dict]:
    """Extract [[Type:Name]] links from markdown and return as structured list."""
    pattern = re.compile(r"\[\[(\w+):([^\]]+)\]\]")
    links = []
    seen = set()
    for match in pattern.finditer(markdown):
        page_type = match.group(1).lower()
        name = match.group(2).strip()
        slug = _slugify(page_type + "-" + name)
        if slug not in seen:
            seen.add(slug)
            links.append({"text": name, "slug": slug, "page_type": page_type})
    return links


def _get_or_create_wiki_page(db: Session, book_id: int, page_type: str, name: str) -> WikiPage:
    slug = _slugify(page_type + "-" + name)
    page = db.query(WikiPage).filter_by(book_id=book_id, slug=slug).first()
    if not page:
        page = WikiPage(book_id=book_id, page_type=page_type, slug=slug, title=name)
        db.add(page)
        db.flush()
    return page


def _latest_version_content(page: WikiPage) -> str:
    if not page.versions:
        return ""
    return max(page.versions, key=lambda v: v.first_visible_chapter).content_markdown


_NUMBERED_CHAPTER_RE = re.compile(
    r"^(?:chapter|part|book|section|volume|act)\s+([IVXLCDM]+|\d+)\.?\s*$",
    re.IGNORECASE,
)


def _roman_to_int(s: str) -> int:
    vals = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}
    result, prev = 0, 0
    for ch in reversed(s.lower()):
        v = vals.get(ch, 0)
        result += v if v >= prev else -v
        prev = v
    return result


def _is_faulty_title(title: str, story_chapter_idx: int) -> bool:
    """
    Return True when the epub title should be replaced by the AI-generated one.

    Faulty cases:
      - Empty or very short (likely missing metadata)
      - Pure number / roman numeral with no label
      - Numbered chapter label ("Chapter 5") whose number doesn't match
        the story chapter index — happens when epub chapters are skipped
        (poems, prefaces, etc.) so the numbering shifts
    Kept as-is:
      - Numbered label that matches the story index ("Chapter 1" == story ch 1)
      - Un-numbered labels like "Prologue", "Epilogue", "Interlude"
      - Any real descriptive title
    """
    t = title.strip()
    if not t or len(t) < 3:
        return True
    # Pure number or roman numeral — no real title at all
    if re.match(r"^[\divxlcdmIVXLCDM\s\.]+$", t):
        return True
    # "Chapter N" / "Part N" etc. — check if the number is consistent
    m = _NUMBERED_CHAPTER_RE.match(t)
    if m:
        num_str = m.group(1)
        num = int(num_str) if num_str.isdigit() else _roman_to_int(num_str)
        return num != story_chapter_idx
    return False


def _apply_alias_map(
    entities: list[dict], summary_md: str, alias_map: dict[str, str | None], entity_info: dict
) -> tuple[list[dict], str]:
    """
    Apply an alias_map (new_name → canonical_name | None) to the entity list
    and summary markdown.
    """
    updated = []
    md = summary_md
    for entity in entities:
        canonical_name = alias_map.get(entity["name"])
        if canonical_name:
            # Find the slug for this canonical name
            canonical_slug = next(
                (s for s, info in entity_info.items() if info["name"] == canonical_name),
                _slugify(entity["type"] + "-" + canonical_name),
            )
            type_cap = entity["type"].capitalize()
            md = md.replace(
                f"[[{type_cap}:{entity['name']}]]",
                f"[[{type_cap}:{canonical_name}]]",
            )
            updated.append({**entity, "slug": canonical_slug, "name": canonical_name})
        else:
            updated.append(entity)
    return updated, md


def _get_previous_summaries(db: Session, book_id: int) -> list[dict]:
    """Reconstruct previous_summaries from all stored summary wiki pages."""
    summary_pages = db.query(WikiPage).filter_by(book_id=book_id, page_type="summary").all()
    result = []
    for page in summary_pages:
        if not page.versions:
            continue
        latest = max(page.versions, key=lambda v: v.first_visible_chapter)
        result.append({"number": latest.first_visible_chapter, "summary": latest.content_markdown})
    result.sort(key=lambda x: x["number"])
    return result


def _get_entity_info(db: Session, book_id: int) -> dict[str, dict]:
    """Reconstruct entity_info from existing non-summary wiki pages."""
    pages = db.query(WikiPage).filter_by(book_id=book_id).all()
    return {
        page.slug: {"type": page.page_type, "name": page.title}
        for page in pages
        if page.page_type != "summary"
    }


async def generate_previews_for_book(book_id: int, db_factory) -> None:
    """
    Generate one-sentence summaries for all chapters so the user can decide
    which to include.  Runs as a background task after EPUB import.
    On completion the book remains in "selecting" status.
    """
    db: Session = db_factory()
    try:
        book = db.query(Book).filter_by(id=book_id).first()
        if not book:
            return

        try:
            api_key, model = await _get_settings(db)
        except ValueError:
            # No API key — leave status as "selecting" with empty summaries
            return

        book.generation_step = "Generating chapter previews…"
        db.commit()

        all_chapters = (
            db.query(Chapter)
            .filter_by(book_id=book_id)
            .order_by(Chapter.number)
            .all()
        )

        to_preview = [
            {"number": c.number, "title": c.title, "preview": c.raw_text[:600].strip()}
            for c in all_chapters
        ]
        summaries = await generate_chapter_previews(api_key, model, to_preview)
        for chapter_obj, summary in zip(all_chapters, summaries):
            chapter_obj.one_sentence_summary = summary

        book.generation_step = None
        db.commit()
    finally:
        db.close()


async def build_wiki_for_book(book_id: int, db_factory) -> None:
    """
    Process the next unprocessed chapter for book_id.

    Sets generation_status to "waiting" after each chapter so the user
    can review before continuing, or "done" when all chapters are complete.

    Invoke once the user has confirmed their chapter selection via
    POST /api/books/{book_id}/confirm-selection.

    db_factory: callable that returns a new SQLAlchemy Session.
    """
    db: Session = db_factory()
    try:
        book = db.query(Book).filter_by(id=book_id).first()
        if not book:
            return

        book.generation_status = "processing"
        book.generation_step = "Starting…"
        db.commit()

        api_key, model = await _get_settings(db)

        all_chapters = (
            db.query(Chapter)
            .filter_by(book_id=book_id)
            .order_by(Chapter.number)
            .all()
        )

        # Work only with story chapters selected by the user
        story_chapters = [c for c in all_chapters if c.is_story_chapter]
        total = len(story_chapters)

        if total == 0:
            book.generation_status = "done"
            book.generation_step = None
            book.total_chapters = 0
            db.commit()
            return

        # Keep total_chapters in sync with the story-chapter count
        book.total_chapters = total
        db.commit()

        # generation_progress = number of story chapters already processed (0-based index into next)
        next_idx = book.generation_progress
        if next_idx >= total:
            book.generation_status = "done"
            book.generation_step = None
            db.commit()
            return

        chapter = story_chapters[next_idx]

        # Reconstruct context from previously processed chapters
        previous_summaries = _get_previous_summaries(db, book_id)
        entity_info = _get_entity_info(db, book_id)

        chapter_dict = {
            "number": chapter.number,
            "title": chapter.title,
            "raw_text": chapter.raw_text,
        }

        # 1. Generate chapter summary
        book.generation_step = f'Summarising chapter {chapter.number}: "{chapter.title}"'
        db.commit()
        try:
            result = await generate_chapter_summary(
                api_key, model, chapter_dict, previous_summaries,
                known_entities=entity_info if entity_info else None,
            )
        except Exception as e:
            book.generation_status = "error"
            book.generation_error = f"Chapter {chapter.number}: {e}"
            db.commit()
            return

        summary_md = result["summary"]
        entities_in_chapter = result["entities"]
        ai_title = result.get("clean_title")
        story_chapter_idx = next_idx + 1  # 1-based story chapter number (used for all versioning)
        clean_title = (ai_title or chapter.title) if _is_faulty_title(chapter.title, story_chapter_idx) else chapter.title

        # Resolve aliases: ask the AI whether any new entities are nicknames /
        # short forms of already-known entities, then patch the markdown.
        new_entities = [e for e in entities_in_chapter if e["slug"] not in entity_info]
        if new_entities and entity_info:
            try:
                alias_map = await resolve_entity_aliases(
                    api_key, model, new_entities, entity_info, summary_md
                )
                if alias_map:
                    entities_in_chapter, summary_md = _apply_alias_map(
                        entities_in_chapter, summary_md, alias_map, entity_info
                    )
            except Exception:
                pass  # alias resolution is best-effort; never block chapter processing

        # Persist the AI-generated title on the chapter row
        chapter.clean_title = clean_title
        db.flush()

        # Store summary page version
        summary_page = _get_or_create_wiki_page(db, book_id, "summary", clean_title)
        links = resolve_links(summary_md)
        db.add(WikiPageVersion(
            page_id=summary_page.id,
            first_visible_chapter=story_chapter_idx,
            content_markdown=summary_md,
            outgoing_links=links,
        ))

        # Track entity type/name for any new slugs seen
        for entity in entities_in_chapter:
            slug = entity["slug"]
            if slug not in entity_info:
                entity_info[slug] = {"type": entity["type"], "name": entity["name"]}

        db.commit()

        # 2. Determine which entities need a page update this chapter.
        #    Always update on first appearance; skip "minor" mentions after that.
        entities_to_update = []
        for entity in entities_in_chapter:
            slug = entity["slug"]
            info = entity_info[slug]
            page = _get_or_create_wiki_page(db, book_id, info["type"], info["name"])
            is_first_appearance = not page.versions
            if is_first_appearance or entity.get("significance") == "major":
                entities_to_update.append({
                    "info": info,
                    "page": page,
                    "existing_content": _latest_version_content(page),
                })

        db.commit()  # flush any new WikiPage rows before async section

        if entities_to_update:
            n = len(entities_to_update)
            book.generation_step = f'Updating {n} entit{"y" if n == 1 else "ies"}…'
            db.commit()

            # 3. Run all entity AI calls in parallel
            semaphore = asyncio.Semaphore(6)

            async def _call_update(task: dict) -> str | Exception:
                async with semaphore:
                    try:
                        return await generate_entity_page(
                            api_key,
                            model,
                            task["info"]["name"],
                            task["info"]["type"],
                            summary_md,
                            story_chapter_idx,
                            task["existing_content"],
                        )
                    except Exception as exc:
                        return exc

            results = await asyncio.gather(*[_call_update(t) for t in entities_to_update])

            # 4. Write results to DB sequentially
            for task, new_content in zip(entities_to_update, results):
                if isinstance(new_content, Exception):
                    continue
                links = resolve_links(new_content)
                db.add(WikiPageVersion(
                    page_id=task["page"].id,
                    first_visible_chapter=story_chapter_idx,
                    content_markdown=new_content,
                    outgoing_links=links,
                ))
            db.commit()

        new_progress = next_idx + 1
        book.generation_progress = new_progress
        book.generation_step = None
        if new_progress >= total:
            book.generation_status = "done"
        elif book.stop_chapter is not None and new_progress >= book.stop_chapter:
            book.generation_status = "waiting"
            book.stop_chapter = None  # clear so resuming works normally
        else:
            book.generation_status = "waiting"
        db.commit()

    except Exception as e:
        db.rollback()
        book = db.query(Book).filter_by(id=book_id).first()
        if book:
            book.generation_status = "error"
            book.generation_error = str(e)
            db.commit()
    finally:
        db.close()
