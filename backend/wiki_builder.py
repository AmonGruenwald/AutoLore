"""
Wiki generation pipeline.

build_wiki_for_book processes exactly ONE chapter up to the entity-selection
pause, then sets generation_status to "waiting_entity_selection".  The user
reviews and confirms the entity list via POST /confirm-entities, which calls
resume_after_entity_selection to complete the chapter (generating wiki pages
and advancing progress to "waiting" or "done").
"""
import asyncio
import re
from sqlalchemy.orm import Session
from database import Book, Chapter, WikiPage, WikiPageVersion, Setting
from ai_service import (
    generate_chapter_previews,
    generate_chapter_summary,
    generate_entity_list,
    generate_entity_page,
    resolve_entity_aliases,
    _slugify,
)


async def _get_settings(db: Session) -> tuple[str, str]:
    api_key = db.query(Setting).filter_by(key="openrouter_api_key").first()
    model = db.query(Setting).filter_by(key="openrouter_model").first()
    if not api_key or not api_key.value:
        raise ValueError("OpenRouter API key not configured")
    return api_key.value, (model.value if model else "deepseek/deepseek-v3.2")


def resolve_links(markdown: str) -> list[dict]:
    """Extract [[Name]] or [[Type:Name]] links from markdown and return as structured list."""
    pattern = re.compile(r"\[\[([^\]]+)\]\]")
    links = []
    seen = set()
    for match in pattern.finditer(markdown):
        raw = match.group(1).strip()
        if ":" in raw:
            _, name = raw.split(":", 1)
            name = name.strip()
        else:
            name = raw
        slug = _slugify(name)
        if slug not in seen:
            seen.add(slug)
            links.append({"text": name, "slug": slug})
    return links


def _get_or_create_wiki_page(db: Session, book_id: int, page_type: str, name: str) -> WikiPage:
    slug = _slugify(name)
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
    Process the next unprocessed chapter for book_id up to the entity-selection
    pause point.

    Flow:
      1. Generate chapter summary (keeps AI conversation history)
      2. Generate scored entity list in the same conversation
      3. Resolve aliases automatically
      4. Store the chapter summary wiki page
      5. Persist pending entity list + conversation history to the Book row
      6. Set generation_status = "waiting_entity_selection"

    The user then reviews the entity list via the frontend and calls
    POST /confirm-entities, which triggers resume_after_entity_selection.

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

        # Chapters excluded by the user that fall between the previous story chapter
        # and this one — their events may be referenced in the current chapter's text.
        prev_original_number = story_chapters[next_idx - 1].number if next_idx > 0 else 0
        skipped_between = [
            {"number": c.number, "title": c.title, "summary": c.one_sentence_summary}
            for c in all_chapters
            if not c.is_story_chapter
            and c.one_sentence_summary
            and prev_original_number < c.number < chapter.number
        ]

        chapter_dict = {
            "number": chapter.number,
            "title": chapter.title,
            "raw_text": chapter.raw_text,
        }

        # 1. Generate chapter summary (returns conversation history for reuse)
        book.generation_step = f'Summarising chapter {chapter.number}: "{chapter.title}"'
        db.commit()
        try:
            result = await generate_chapter_summary(
                api_key, model, chapter_dict, previous_summaries,
                known_entities=entity_info if entity_info else None,
                skipped_chapters=skipped_between if skipped_between else None,
            )
        except Exception as e:
            book.generation_status = "error"
            book.generation_error = f"Chapter {chapter.number}: {e}"
            db.commit()
            return

        summary_md = result["summary"]
        ai_title = result.get("clean_title")
        conversation_history: list[dict] = result.get("conversation_history", [])
        story_chapter_idx = next_idx + 1  # 1-based story chapter number (used for all versioning)
        clean_title = (ai_title or chapter.title) if _is_faulty_title(chapter.title, story_chapter_idx) else chapter.title

        # 2. Generate scored entity list in the same conversation
        book.generation_step = f'Identifying entities in chapter {chapter.number}…'
        db.commit()
        try:
            scored_entities, conversation_history = await generate_entity_list(
                api_key, model, conversation_history,
                known_entities=entity_info if entity_info else None,
            )
        except Exception:
            # Entity list generation is best-effort; fall back to the raw entities
            # extracted from the summary if the dedicated call fails.
            scored_entities = result.get("entities", [])

        # 3. Resolve aliases: patch summary markdown and entity list so the user
        #    sees canonical names rather than aliases.
        new_entities = [e for e in scored_entities if e["slug"] not in entity_info]
        if new_entities and entity_info:
            try:
                alias_map = await resolve_entity_aliases(
                    api_key, model, new_entities, entity_info, summary_md
                )
                if alias_map:
                    scored_entities, summary_md = _apply_alias_map(
                        scored_entities, summary_md, alias_map, entity_info
                    )
            except Exception:
                pass  # alias resolution is best-effort

        # Persist the AI-generated title on the chapter row
        chapter.clean_title = clean_title
        db.flush()

        # 4. Store the chapter summary wiki page now (doesn't need entity confirmation)
        summary_page = _get_or_create_wiki_page(db, book_id, "summary", clean_title)
        links = resolve_links(summary_md)
        db.add(WikiPageVersion(
            page_id=summary_page.id,
            first_visible_chapter=story_chapter_idx,
            content_markdown=summary_md,
            outgoing_links=links,
        ))

        # 5. Persist pending data and pause for entity selection
        book.pending_chapter_summary = summary_md
        book.pending_entity_list = scored_entities
        book.pending_conversation_history = conversation_history
        book.generation_status = "waiting_entity_selection"
        book.generation_step = None
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


async def resume_after_entity_selection(
    book_id: int,
    selected_entities: list[dict],
    db_factory,
) -> None:
    """
    Resume chapter processing after the user has confirmed which entities to update.

    selected_entities: list of dicts from the confirm-entities request, each with:
      {type, name, slug, aliases (list), merge_into_slug (str|None)}

    Uses the pending_conversation_history stored on the Book row so that entity
    page generation continues in the same AI conversation as the chapter summary,
    avoiding the need to re-send the full chapter text.
    """
    db: Session = db_factory()
    try:
        book = db.query(Book).filter_by(id=book_id).first()
        if not book:
            return
        if book.generation_status != "waiting_entity_selection":
            return

        book.generation_status = "processing"
        book.generation_step = "Applying entity selection…"
        db.commit()

        api_key, model = await _get_settings(db)

        all_chapters = (
            db.query(Chapter)
            .filter_by(book_id=book_id)
            .order_by(Chapter.number)
            .all()
        )
        story_chapters = [c for c in all_chapters if c.is_story_chapter]
        total = len(story_chapters)
        next_idx = book.generation_progress
        story_chapter_idx = next_idx + 1

        summary_md: str = book.pending_chapter_summary or ""
        conversation_history: list[dict] = book.pending_conversation_history or []

        # Reconstruct entity_info for determining first-appearance
        entity_info = _get_entity_info(db, book_id)

        # Apply user renames and aliases before touching wiki pages
        for sel in selected_entities:
            new_aliases: list[str] = sel.get("aliases") or []
            merge_into_slug: str | None = sel.get("merge_into_slug")

            # If merging into an existing entity, redirect this entity's slug
            if merge_into_slug:
                target_page = db.query(WikiPage).filter_by(
                    book_id=book_id, slug=merge_into_slug
                ).first()
                if target_page:
                    # Treat the selected entity as an alias of the target
                    aliases = list(target_page.aliases or [])
                    if sel["slug"] not in aliases:
                        aliases.append(sel["slug"])
                    target_page.aliases = aliases
                    db.flush()
                    # Redirect slug for page lookup below
                    sel = {**sel, "slug": merge_into_slug, "name": target_page.title, "type": target_page.page_type}

            # Apply user-added aliases to the wiki page
            if new_aliases:
                page = _get_or_create_wiki_page(db, book_id, sel["type"], sel["name"])
                existing = list(page.aliases or [])
                for alias in new_aliases:
                    alias_slug = _slugify(alias)
                    if alias_slug not in existing:
                        existing.append(alias_slug)
                page.aliases = existing
                db.flush()

        db.commit()

        # Build the list of tasks for entity page generation
        entities_to_update = []
        for sel in selected_entities:
            merge_into_slug: str | None = sel.get("merge_into_slug")
            effective_slug = merge_into_slug if merge_into_slug else sel["slug"]
            effective_name = sel["name"]
            effective_type = sel["type"]

            if merge_into_slug:
                target_page = db.query(WikiPage).filter_by(
                    book_id=book_id, slug=merge_into_slug
                ).first()
                if target_page:
                    effective_name = target_page.title
                    effective_type = target_page.page_type

            page = _get_or_create_wiki_page(db, book_id, effective_type, effective_name)
            entities_to_update.append({
                "page": page,
                "page_title": page.title,
                "page_type": page.page_type,
                "existing_content": _latest_version_content(page),
            })

        db.commit()  # flush any new WikiPage rows before async section

        if entities_to_update:
            n = len(entities_to_update)
            book.generation_step = f'Updating {n} entit{"y" if n == 1 else "ies"}…'
            db.commit()

            semaphore = asyncio.Semaphore(6)

            async def _call_update(task: dict) -> str | Exception:
                async with semaphore:
                    try:
                        return await generate_entity_page(
                            api_key,
                            model,
                            task["page_title"],
                            task["page_type"],
                            summary_md,
                            story_chapter_idx,
                            task["existing_content"],
                            conversation_history=conversation_history,
                        )
                    except Exception as exc:
                        return exc

            results = await asyncio.gather(*[_call_update(t) for t in entities_to_update])

            for task, new_content in zip(entities_to_update, results):
                if isinstance(new_content, Exception):
                    continue
                if new_content.strip().upper() == "SKIP" or not new_content.strip():
                    continue
                links = resolve_links(new_content)
                db.add(WikiPageVersion(
                    page_id=task["page"].id,
                    first_visible_chapter=story_chapter_idx,
                    content_markdown=new_content,
                    outgoing_links=links,
                ))
            db.commit()

        # Clear pending data
        book.pending_chapter_summary = None
        book.pending_entity_list = None
        book.pending_conversation_history = None

        new_progress = next_idx + 1
        book.generation_progress = new_progress
        book.generation_step = None
        if new_progress >= total:
            book.generation_status = "done"
        elif book.stop_chapter is not None and new_progress >= book.stop_chapter:
            book.generation_status = "waiting"
            book.stop_chapter = None
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
