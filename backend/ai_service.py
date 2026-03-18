"""OpenRouter API interactions with strict grounding."""
import asyncio
import httpx
import json
import re
from typing import Any

OPENROUTER_BASE = "https://openrouter.ai/api/v1"

GROUNDING_SYSTEM = """You are a wiki editor building an encyclopedia exclusively from provided book text.

STRICT RULES — violating any rule is unacceptable:
1. ONLY use information explicitly stated in the provided text passages.
2. NEVER use any prior knowledge, even if names seem familiar from real-world sources.
3. Treat every character, place, and event as fictional and unknown to you.
4. If something is not mentioned in the text, do not include it.
5. Do not invent, infer, or extrapolate beyond what the text says.
6. Do not reference the author, publication date, or any external facts about the book.
"""


async def _call_openrouter(
    api_key: str,
    model: str,
    messages: list[dict],
    temperature: float = 0.2,
    max_tokens: int | None = None,
) -> str:
    body: dict = {"model": model, "messages": messages, "temperature": temperature}
    if max_tokens is not None:
        body["max_tokens"] = max_tokens
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{OPENROUTER_BASE}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost",
                "X-Title": "AutoLore",
            },
            json=body,
        )
        if resp.is_error:
            try:
                err_body = resp.json()
                err_msg = err_body.get("error", {}).get("message") or str(err_body)
            except Exception:
                err_msg = resp.text
            raise ValueError(f"OpenRouter {resp.status_code}: {err_msg}")
        data = resp.json()
        choices = data.get("choices") or []
        if not choices:
            err = data.get("error") or data
            raise ValueError(f"API returned no choices: {err}")
        content = choices[0]["message"]["content"]
        if content is None:
            raise ValueError("API returned null content")
        return content



async def _classify_single_chapter(
    api_key: str,
    model: str,
    chapter: dict,
    semaphore: asyncio.Semaphore,
) -> bool:
    """Classify one chapter as story (True) or supplementary (False)."""
    prompt = f"""Is this book chapter part of the story, or is it supplementary material?

Opening text: {chapter['preview']}
Title: {chapter['title']}

Supplementary (false):
- Author bio, acknowledgements, dedications, publisher/series announcements, copyright
- Glossary or terminology lists (defines words/terms)
- Cast lists, character lists, dramatis personae (lists character names with brief descriptions)
- Appendix, bibliography, index, endnotes, maps list

Story (true): narrative prose with characters, dialogue, events, or worldbuilding.
Prologues, epilogues, and interludes with narrative content are story.

Judge by the opening text above, not the title. Answer with one word: true or false"""

    async with semaphore:
        try:
            raw = await _call_openrouter(
                api_key, model,
                [{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=5,
            )
            return raw.strip().lower().startswith("true")
        except Exception:
            return True


async def _generate_single_preview(
    api_key: str,
    model: str,
    chapter: dict,
    semaphore: asyncio.Semaphore,
) -> str:
    """Generate a one-sentence summary for a chapter to help the user decide whether to include it."""
    prompt = f"""Write ONE sentence (max 25 words) describing what happens or what this section is about.
Be factual and specific to the content, not generic.

Title: {chapter['title']}
Opening text:
{chapter['preview']}

Reply with only the single sentence, no quotes."""

    async with semaphore:
        try:
            raw = await _call_openrouter(
                api_key, model,
                [{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=60,
            )
            return raw.strip()
        except Exception:
            return ""


async def generate_chapter_previews(
    api_key: str,
    model: str,
    chapters: list[dict],
) -> list[str]:
    """
    Generate a one-sentence summary for each chapter in parallel.
    Returns a list of strings in the same order as the input.
    """
    semaphore = asyncio.Semaphore(8)
    results = await asyncio.gather(
        *[_generate_single_preview(api_key, model, c, semaphore) for c in chapters]
    )
    return list(results)


async def classify_story_chapters(
    api_key: str,
    model: str,
    chapters: list[dict],
) -> list[bool]:
    """
    Classify each chapter individually in parallel.
    Returns a list of booleans — True = story, False = supplementary.
    """
    semaphore = asyncio.Semaphore(8)
    results = await asyncio.gather(
        *[_classify_single_chapter(api_key, model, c, semaphore) for c in chapters]
    )
    return list(results)


async def generate_chapter_summary(
    api_key: str,
    model: str,
    chapter: dict,
    previous_summaries: list[dict],
    known_entities: dict[str, dict] | None = None,
    skipped_chapters: list[dict] | None = None,
) -> dict:
    """
    Returns:
      {
        "clean_title": "short descriptive chapter title",
        "summary": "markdown text with [[Name]] links",
        "entities": [{"type": "character|place|event", "name": "...", "slug": "..."}]
      }
    known_entities: unused — kept for API compatibility.
    skipped_chapters: chapters excluded by the user that fall between the previous
      wiki chapter and this one; included so the AI doesn't misattribute their events.
    """
    prev_context = ""
    if previous_summaries:
        prev_context = "Previously summarized chapters for context:\n" + "\n".join(
            f"- Chapter {s['number']}: {s['summary'][:300]}..."
            for s in previous_summaries[-5:]
        )

    skipped_context = ""
    if skipped_chapters:
        skipped_context = (
            "\nNote: the following chapters from the original book were excluded from "
            "this wiki by the user (they exist in the source but are not included). "
            "Their events may be referenced in the current chapter's text — acknowledge "
            "them briefly as prior context but do NOT write a wiki entry for them:\n"
            + "\n".join(
                f"- (Excluded) \"{s['title']}\": {s['summary']}"
                for s in skipped_chapters
            )
            + "\n"
        )

    prompt = f"""{prev_context}{skipped_context}
Current chapter text to summarize:
{chapter['raw_text']}

Instructions:
- Write a wiki-style summary of this chapter (3-8 paragraphs).
- Only include information from the text above.
- When mentioning a character, place, or important event, use wiki-link syntax:
  [[Name]] (e.g. [[Aragorn]], [[Minas Tirith]], [[Battle of Helm's Deep]])
- Use the most complete name for each entity as it appears in the text.
- After the summary, output a JSON block listing all entities you linked to.
- For each entity set "significance" to "major" if ANY of the following apply:
  they have an active role, dialogue, revealed attributes (appearance, personality,
  backstory, relationships, title, status), their situation changes, they perform
  or receive an action, or any descriptive context about them appears in the chapter.
  Set it to "minor" ONLY if the entity is referenced purely by name with absolutely
  no additional context, description, or new information of any kind.

Output format:
<title>[short, descriptive title for this chapter (4-8 words, based on the key events)]</title>
<summary>
[your summary markdown here]
</summary>
<entities>
[{{"type": "character", "name": "ExactName", "significance": "major"}}, ...]
</entities>"""

    messages = [
        {"role": "system", "content": GROUNDING_SYSTEM},
        {"role": "user", "content": prompt},
    ]

    raw = await _call_openrouter(api_key, model, messages, max_tokens=1200)
    return _parse_summary_response(raw, chapter["number"])


def _parse_summary_response(raw: str, chapter_number: int) -> dict:
    title_match = re.search(r"<title>(.*?)</title>", raw, re.DOTALL)
    summary_match = re.search(r"<summary>(.*?)</summary>", raw, re.DOTALL)
    entities_match = re.search(r"<entities>(.*?)</entities>", raw, re.DOTALL)

    clean_title = title_match.group(1).strip() if title_match else None
    summary = summary_match.group(1).strip() if summary_match else raw.strip()

    entities = []
    if entities_match:
        try:
            raw_entities = json.loads(entities_match.group(1).strip())
            for e in raw_entities:
                if "type" in e and "name" in e:
                    entities.append({
                        "type": e["type"].lower(),
                        "name": e["name"],
                        "slug": _slugify(e["name"]),
                        "significance": e.get("significance", "major").lower(),
                    })
        except json.JSONDecodeError:
            pass

    return {"clean_title": clean_title, "summary": summary, "entities": entities, "chapter_number": chapter_number}


async def generate_entity_page(
    api_key: str,
    model: str,
    entity_name: str,
    entity_type: str,
    chapter_summary: str,
    chapter_number: int,
    existing_content: str = "",
) -> str:
    """
    Incrementally update an entity wiki page using only the current chapter summary
    and the existing page content.  No raw chapter text is sent.
    Returns updated markdown content with [[Name]] links.
    """
    type_instructions = {
        "character": "physical description, personality, relationships, role in story, notable actions",
        "place": "physical description, atmosphere, significance, who visits or lives there",
        "event": "what happened, who was involved, causes, consequences, timeline position",
    }.get(entity_type, "all relevant details")

    focus_rule = (
        f'CRITICAL: Write ONLY about the {entity_type} named "{entity_name}". '
        f'The summary mentions other characters and entities — ignore them except '
        f'when they directly interact with or affect "{entity_name}".'
    )

    if existing_content:
        prompt = f"""Update the wiki page for {entity_type.upper()}: "{entity_name}".

{focus_rule}

Existing page:
{existing_content}

New information from Chapter {chapter_number} summary:
{chapter_summary}

Instructions:
- Extract ONLY facts about "{entity_name}" from the chapter summary above.
- The page must reflect "{entity_name}"'s CURRENT state as shown in Chapter {chapter_number}.
- For time-sensitive attributes (age, appearance, physical condition, social status, role,
  relationships, location, allegiances): if the new chapter shows a change, REPLACE the old
  value — do not keep both. The page should read as a current description, not a history log.
- For permanent facts (origin, backstory, fixed traits): retain them unless contradicted.
- Add any genuinely new information not already covered.
- Use [[Name]] syntax for cross-references to characters, places, and events.
- Use markdown formatting (## headings, bullet lists where appropriate).
- Do not include a top-level title.
- Output the complete updated page."""
    else:
        prompt = f"""Create a wiki page for {entity_type.upper()}: "{entity_name}".

{focus_rule}

Source — Chapter {chapter_number} summary:
{chapter_summary}

Extract ONLY information about "{entity_name}" and write a wiki page covering: {type_instructions}.
- Only include details explicitly stated in the summary above that concern "{entity_name}".
- Use [[Name]] syntax for cross-references to characters, places, and events.
- Use markdown formatting (## headings, bullet lists where appropriate).
- Do not include a top-level title."""

    messages = [
        {"role": "system", "content": GROUNDING_SYSTEM},
        {"role": "user", "content": prompt},
    ]

    return await _call_openrouter(api_key, model, messages, max_tokens=800)


async def resolve_entity_aliases(
    api_key: str,
    model: str,
    new_entities: list[dict],
    known_entities: dict[str, dict],
    chapter_summary: str,
) -> dict[str, str | None]:
    """
    Given entities the AI found in a chapter that don't yet exist in the wiki,
    determine which (if any) are aliases/nicknames for already-known entities.

    Returns a dict mapping each new entity name to its canonical known name,
    or None if it is genuinely new.  Only unambiguous matches are returned.
    """
    if not new_entities or not known_entities:
        return {}

    by_type: dict[str, list[str]] = {}
    for info in known_entities.values():
        by_type.setdefault(info["type"], []).append(info["name"])

    known_lines = "\n".join(
        f"{t.capitalize()}s: {', '.join(sorted(names))}"
        for t, names in sorted(by_type.items())
    )

    new_lines = "\n".join(
        f"- {e['type'].capitalize()}: {e['name']}" for e in new_entities
    )

    prompt = f"""You are resolving entity aliases while building a book wiki.

Chapter summary (use this for context clues):
{chapter_summary}

Already-known entities:
{known_lines}

Newly mentioned entities (not yet in the wiki):
{new_lines}

Task: For each new entity, decide whether it is clearly the same as a known entity
(e.g. a nickname, short name, title, or alias) or a genuinely new entity.

Rules:
- Only mark as an alias when you are confident from the summary context.
- If the match is ambiguous or unclear, treat it as new (null).
- A character sharing only a common word (e.g. "the Guard") is NOT an alias.

Respond with ONLY valid JSON — an object mapping each new entity name to the
canonical known name (string) or null if it is new:
{{"Name1": "Canonical Name", "Name2": null, ...}}"""

    messages = [
        {"role": "system", "content": "You are a precise JSON-only responder."},
        {"role": "user", "content": prompt},
    ]
    raw = await _call_openrouter(api_key, model, messages, max_tokens=300)
    # Strip markdown fences if present
    raw = re.sub(r"^```[a-z]*\n?", "", raw.strip(), flags=re.MULTILINE)
    raw = re.sub(r"\n?```$", "", raw.strip(), flags=re.MULTILINE)
    try:
        result = json.loads(raw.strip())
        if isinstance(result, dict):
            return {k: v for k, v in result.items() if isinstance(k, str)}
    except (json.JSONDecodeError, ValueError):
        pass
    return {}


async def merge_wiki_pages(
    api_key: str,
    model: str,
    title_a: str,
    page_type: str,
    content_a: str,
    title_b: str,
    content_b: str,
) -> dict:
    """
    Merge two wiki pages of the same type into one.
    Returns {"title": ..., "content": ...}.
    """
    prompt = f"""Merge these two wiki pages about the same {page_type} into a single comprehensive page.

Page 1: "{title_a}"
{content_a}

---

Page 2: "{title_b}"
{content_b}

---

Instructions:
- These pages describe the same {page_type}, possibly under different names or from different angles.
- Combine all unique information; remove duplicate sentences.
- Preserve all [[Name]] wiki-link syntax.
- Use markdown formatting (## headings, bullet lists where appropriate).
- Do NOT include a top-level title in the content — that goes in <title> only.
- Pick the most complete, recognisable name for the merged page.

Output exactly:
<title>[best name for this {page_type}]</title>
<content>
[merged wiki page content]
</content>"""

    messages = [
        {"role": "system", "content": GROUNDING_SYSTEM},
        {"role": "user", "content": prompt},
    ]
    raw = await _call_openrouter(api_key, model, messages, max_tokens=1400)

    title_match   = re.search(r"<title>(.*?)</title>", raw, re.DOTALL)
    content_match = re.search(r"<content>(.*?)</content>", raw, re.DOTALL)

    return {
        "title":   title_match.group(1).strip()   if title_match   else title_a,
        "content": content_match.group(1).strip() if content_match else f"{content_a}\n\n---\n\n{content_b}",
    }


async def propagate_wiki_edit(
    api_key: str,
    model: str,
    page_type: str,
    old_content: str,
    new_content: str,
    future_content: str,
) -> dict:
    """
    A user manually edited a wiki page.  Apply those edits to a later auto-generated
    version of the same page that was already created for a future chapter.

    Returns {"content": ...}.
    """
    prompt = f"""A user manually edited a wiki page ({page_type}).
Apply the user's changes to the later version of the same page, while preserving
any additional information that only exists in the later version.

--- ORIGINAL (before user edit) ---
{old_content}

--- USER'S EDITED VERSION ---
{new_content}

--- LATER AUTO-GENERATED VERSION (from a future chapter) ---
{future_content}

Instructions:
- Identify what the user added, removed, or changed between the ORIGINAL and USER'S EDITED VERSION.
- Apply those same changes to the LATER VERSION.
- Keep all information in the LATER VERSION that is not contradicted by the user's edit.
- Preserve all [[Name]] wiki-link syntax.
- Do NOT include a top-level title.
- Output only the updated content, no commentary.

<content>
[updated later version]
</content>"""

    messages = [
        {"role": "system", "content": GROUNDING_SYSTEM},
        {"role": "user", "content": prompt},
    ]
    raw = await _call_openrouter(api_key, model, messages, max_tokens=1000)

    content_match = re.search(r"<content>(.*?)</content>", raw, re.DOTALL)
    return {
        "content": content_match.group(1).strip() if content_match else future_content,
    }


async def check_duplicate_book(
    api_key: str,
    model: str,
    candidate_title: str,
    candidate_author: str,
    candidate_excerpt: str,
    existing_title: str,
    existing_author: str,
    existing_excerpt: str,
) -> dict:
    """
    Returns {"is_duplicate": bool, "confidence": float, "reasoning": str}
    """
    prompt = f"""Compare these two books and determine if they are the same book.

Book A:
Title: {candidate_title}
Author: {candidate_author}
Opening excerpt: {candidate_excerpt[:500]}

Book B:
Title: {existing_title}
Author: {existing_author}
Opening excerpt: {existing_excerpt[:500]}

Are these the same book? Consider title variations, author name variations, and content similarity.
Respond ONLY with valid JSON: {{"is_duplicate": true/false, "confidence": 0.0-1.0, "reasoning": "brief explanation"}}"""

    messages = [
        {"role": "user", "content": prompt},
    ]

    raw = await _call_openrouter(api_key, model, messages, temperature=0.0)
    try:
        # Find JSON in response
        json_match = re.search(r"\{.*\}", raw, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
    except (json.JSONDecodeError, AttributeError):
        pass
    return {"is_duplicate": False, "confidence": 0.0, "reasoning": "Parse error"}


async def answer_question(
    api_key: str,
    model: str,
    question: str,
    context_pages: list[dict],
    chapter_number: int,
    conversation_history: list[dict] | None = None,
) -> str:
    """
    Answer a reader's question using only wiki pages visible up to chapter_number.
    context_pages: [{"title": str, "type": str, "content": str}, ...]
    conversation_history: prior [{"role": "user"|"assistant", "content": str}] turns
    """
    if context_pages:
        parts = [
            f"### {p['title']} ({p['type']})\n{p['content']}"
            for p in context_pages
        ]
        context_text = "\n\n---\n\n".join(parts)
    else:
        context_text = "(No wiki entries are available yet for this chapter.)"

    system_prompt = f"""You are a helpful reading companion for someone currently at chapter {chapter_number} of a book.

STRICT RULES:
1. Answer ONLY using the wiki entries provided below. Do not draw on any prior knowledge about this book.
2. If the answer cannot be found in the provided entries, say so clearly — do not guess or extrapolate.
3. Never hint at or reveal anything beyond what is already described in the entries below.
4. Be concise but thorough. Reference character, place, and event names exactly as written.
5. You may reason across multiple entries to form an answer.

WIKI ENTRIES (all information available up to chapter {chapter_number}):

{context_text}"""

    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    if conversation_history:
        messages.extend(conversation_history)
    messages.append({"role": "user", "content": question})

    return await _call_openrouter(api_key, model, messages, temperature=0.3, max_tokens=600)


def score_page_relevance(question: str, title: str, content: str) -> float:
    """Keyword-based relevance score for RAG page selection."""
    stop_words = {
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'what', 'who', 'where',
        'when', 'how', 'does', 'did', 'do', 'in', 'of', 'to', 'and', 'or',
        'for', 'with', 'about', 'tell', 'me', 'know', 'can', 'has', 'have',
        'had', 'his', 'her', 'their', 'its', 'that', 'this', 'which', 'he',
        'she', 'they', 'it', 'be', 'at', 'by', 'from', 'as', 'on', 'not',
        'but', 'also', 'any', 'all', 'been', 'will', 'would', 'could', 'my',
    }
    words = {w for w in re.findall(r'\w+', question.lower()) if len(w) >= 3} - stop_words
    if not words:
        return 0.0

    combined = (title + ' ' + content).lower()
    title_lower = title.lower()
    score = 0.0
    for word in words:
        if word in title_lower:
            score += 3.0          # strong signal: question term matches page title
        count = combined.count(word)
        score += min(count * 0.4, 2.0)   # content frequency, capped per term
    return score


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text.strip("-")
