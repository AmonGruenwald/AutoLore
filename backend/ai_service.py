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


def _build_chapter_context(chapters: list[dict]) -> str:
    parts = []
    for ch in chapters:
        parts.append(f"=== {ch['title']} (Chapter {ch['number']}) ===\n{ch['raw_text']}")
    return "\n\n".join(parts)


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

Output format:
<summary>
[your summary markdown here]
</summary>
<entities>
[{{"type": "character", "name": "ExactName"}}, ...]
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
                    })
        except json.JSONDecodeError:
            pass

    return {"summary": summary, "entities": entities, "chapter_number": chapter_number}


async def generate_entity_page(
    api_key: str,
    model: str,
    entity_name: str,
    entity_type: str,
    chapters_with_entity: list[dict],
    existing_content: str = "",
) -> str:
    """
    Generate/update an entity wiki page based only on the provided chapters.
    Returns updated markdown content with [[Type:Name]] links.
    """
    chapter_context = _build_chapter_context(chapters_with_entity)
    existing_section = ""
    if existing_content:
        existing_section = f"\nExisting wiki page content (from previous chapters):\n{existing_content}\n"

    type_instructions = {
        "character": "physical description, personality, relationships, role in the story, notable actions",
        "place": "physical description, atmosphere, significance to the story, who visits or lives there",
        "event": "what happened, who was involved, causes, consequences, timeline position",
    }.get(entity_type, "all relevant details")

    prompt = f"""You are updating the wiki page for {entity_type.upper()}: "{entity_name}".
{existing_section}
Source text (only use information from here):
{chapter_context}

Write a complete wiki page for "{entity_name}" covering: {type_instructions}.
- Only include information explicitly stated in the text.
- Use [[Character:Name]], [[Place:Name]], [[Event:Name]] syntax for cross-references.
- Use markdown formatting (## headings, bullet lists where appropriate).
- Do not include a top-level title (it will be added by the UI).
- Do not speculate or add information not in the text."""

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
