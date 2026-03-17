"""OpenRouter API interactions with strict grounding."""
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
) -> str:
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{OPENROUTER_BASE}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost",
                "X-Title": "AutoLore",
            },
            json={
                "model": model,
                "messages": messages,
                "temperature": temperature,
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]



async def classify_story_chapters(
    api_key: str,
    model: str,
    chapters: list[dict],
) -> list[bool]:
    """
    Given a list of chapter dicts with 'number', 'title', and 'preview' (first ~200 chars),
    returns a list of booleans — True if the chapter is part of the story, False if it is
    supplementary material (author bios, acknowledgements, glossary, appendix, maps, etc.).
    """
    chapter_list = "\n".join(
        f"{i+1}. [{c['title']}] {c['preview']}"
        for i, c in enumerate(chapters)
    )
    prompt = f"""Below is a numbered list of chapters from a book. Each entry shows the chapter title and its opening text.

{chapter_list}

Decide for each chapter whether it is part of the actual story/narrative (true) or supplementary material (false).
Supplementary material includes: author biographical notes, acknowledgements, dedications, maps/figures lists, glossary, appendix, bibliography, endnotes, copyright pages, "about the author" sections, publisher notes, and any other non-narrative content.
Prologues, epilogues, interludes, and chapters with story content should be marked true.

Respond with ONLY a JSON array of booleans, one per chapter, in order. Example for 4 chapters: [true, true, false, true]"""

    raw = await _call_openrouter(api_key, model, [{"role": "user", "content": prompt}], temperature=0.0)
    # Extract the JSON array from the response
    match = re.search(r'\[[\s\S]*\]', raw)
    if not match:
        # If parsing fails, default everything to true
        return [True] * len(chapters)
    try:
        result = json.loads(match.group())
        if len(result) != len(chapters):
            return [True] * len(chapters)
        return [bool(v) for v in result]
    except Exception:
        return [True] * len(chapters)


async def generate_chapter_summary(
    api_key: str,
    model: str,
    chapter: dict,
    previous_summaries: list[dict],
) -> dict:
    """
    Returns:
      {
        "summary": "markdown text with [[Type:Name]] links",
        "entities": [{"type": "character|place|event", "name": "...", "slug": "..."}]
      }
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
- Use the exact name as it appears in the text.
- After the summary, output a JSON block listing all entities you linked to.
- For each entity set "significance" to "major" if they have an active role, dialogue,
  revealed attributes, or their situation changes in this chapter.
  Set it to "minor" if they are only named in passing with no new information.

Output format:
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

    raw = await _call_openrouter(api_key, model, messages)
    return _parse_summary_response(raw, chapter["number"])


def _parse_summary_response(raw: str, chapter_number: int) -> dict:
    summary_match = re.search(r"<summary>(.*?)</summary>", raw, re.DOTALL)
    entities_match = re.search(r"<entities>(.*?)</entities>", raw, re.DOTALL)

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

    return {"summary": summary, "entities": entities, "chapter_number": chapter_number}


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

    if existing_content:
        prompt = f"""Update the wiki page for {entity_type.upper()}: "{entity_name}".

Existing page:
{existing_content}

New information from Chapter {chapter_number} summary:
{chapter_summary}

Instructions:
- Incorporate any new information from this chapter into the existing page.
- Only add details explicitly stated in the chapter summary above.
- Keep all existing accurate information; do not remove it.
- Use [[Character:Name]], [[Place:Name]], [[Event:Name]] syntax for cross-references.
- Use markdown formatting (## headings, bullet lists where appropriate).
- Do not include a top-level title.
- Output the complete updated page."""
    else:
        prompt = f"""Create a wiki page for {entity_type.upper()}: "{entity_name}".

Source — Chapter {chapter_number} summary:
{chapter_summary}

Write a wiki page covering: {type_instructions}.
- Only include information explicitly stated above.
- Use [[Character:Name]], [[Place:Name]], [[Event:Name]] syntax for cross-references.
- Use markdown formatting (## headings, bullet lists where appropriate).
- Do not include a top-level title."""

    messages = [
        {"role": "system", "content": GROUNDING_SYSTEM},
        {"role": "user", "content": prompt},
    ]

    return await _call_openrouter(api_key, model, messages)


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
