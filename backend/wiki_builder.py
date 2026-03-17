"""
Wiki generation pipeline — runs once on book import.
Processes chapters sequentially, building versioned wiki pages.
"""
import asyncio
import re
from sqlalchemy.orm import Session
from database import Book, Chapter, WikiPage, WikiPageVersion, Setting
from ai_service import generate_chapter_summary, generate_entity_page, _slugify


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


async def build_wiki_for_book(book_id: int, db_factory) -> None:
    """
    Main generation pipeline. Called in background after book import.
    db_factory: callable that returns a new Session.
    """
    db: Session = db_factory()
    try:
        book = db.query(Book).filter_by(id=book_id).first()
        if not book:
            return

        book.generation_status = "processing"
        book.generation_progress = 0
        book.generation_step = "Starting…"
        db.commit()

        api_key, model = await _get_settings(db)
        chapters = db.query(Chapter).filter_by(book_id=book_id).order_by(Chapter.number).all()

        # entity_info: slug -> {type, name} — tracks entity identity across chapters
        entity_info: dict[str, dict] = {}

        previous_summaries = []

        for chapter in chapters:
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
                    api_key, model, chapter_dict, previous_summaries
                )
            except Exception as e:
                book.generation_status = "error"
                book.generation_error = f"Chapter {chapter.number}: {e}"
                db.commit()
                return

            summary_md = result["summary"]
            entities_in_chapter = result["entities"]

            # Create/update summary page version
            summary_page = _get_or_create_wiki_page(db, book_id, "summary", chapter.title)
            links = resolve_links(summary_md)
            db.add(WikiPageVersion(
                page_id=summary_page.id,
                first_visible_chapter=chapter.number,
                content_markdown=summary_md,
                outgoing_links=links,
            ))

            # Track entity type/name for any new slugs seen
            for entity in entities_in_chapter:
                slug = entity["slug"]
                if slug not in entity_info:
                    entity_info[slug] = {"type": entity["type"], "name": entity["name"]}

            db.commit()

            previous_summaries.append({"number": chapter.number, "summary": summary_md})

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
                book.generation_step = f'Updating {n} entit{"y" if n == 1 else "ies"} for chapter {chapter.number}…'
                db.commit()

                # 3. Run all entity AI calls in parallel (cap concurrency to avoid rate limits)
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
                                chapter.number,
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
                        first_visible_chapter=chapter.number,
                        content_markdown=new_content,
                        outgoing_links=links,
                    ))
                db.commit()

            book.generation_progress = chapter.number
            db.commit()

        book.generation_status = "done"
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
