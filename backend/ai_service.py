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
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]



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
) -> dict:
    """
    Returns:
      {
        "clean_title": "short descriptive chapter title",
        "summary": "markdown text with [[Type:Name]] links",
        "entities": [{"type": "character|place|event", "name": "...", "slug": "..."}]
      }
    known_entities: unused — kept for API compatibility.
    """
    prev_context = ""
    if previous_summaries:
        prev_context = "Previously summarized chapters for context:\n" + "\n".join(
            f"- Chapter {s['number']}: {s['summary'][:300]}..."
            for s in previous_summaries[-5:]
        )

    prompt = f"""{prev_context}

Current chapter text to summarize:
{chapter['raw_text']}

Instructions:
- Write a wiki-style summary of this chapter (3-8 paragraphs).
- Only include information from the text above.
- When mentioning a character, place, or important event, use wiki-link syntax:
  [[Character:Name]], [[Place:Name]], [[Event:Name]]
- Use the most complete name for each entity as it appears in the text.
- After the summary, output a JSON block listing all entities you linked to.
- For each entity set "significance" to "major" if they have an active role, dialogue,
  revealed attributes, or their situation changes in this chapter.
  Set it to "minor" if they are only named in passing with no new information.

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
                        "slug": _slugify(e["type"] + "-" + e["name"]),
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
    Returns updated markdown content with [[Type:Name]] links.
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
- Incorporate new information into the existing page.
- Keep all existing accurate information; do not remove it.
- Use [[Character:Name]], [[Place:Name]], [[Event:Name]] syntax for cross-references.
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
- Use [[Character:Name]], [[Place:Name]], [[Event:Name]] syntax for cross-references.
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


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text.strip("-")
