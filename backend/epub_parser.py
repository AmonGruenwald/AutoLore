"""Parse EPUB files into structured chapter data."""
import re
from dataclasses import dataclass
from bs4 import BeautifulSoup
import ebooklib
from ebooklib import epub


@dataclass
class ParsedChapter:
    number: int
    title: str
    raw_text: str


@dataclass
class ParsedBook:
    title: str
    author: str
    chapters: list[ParsedChapter]


def _html_to_text(html_content: str) -> str:
    soup = BeautifulSoup(html_content, "html.parser")
    # Remove script/style tags
    for tag in soup(["script", "style"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    # Collapse excessive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _is_content_chapter(item: epub.EpubHtml) -> bool:
    """Heuristic: skip nav/toc/cover items."""
    name = (item.file_name or "").lower()
    skip_patterns = ["nav", "toc", "cover", "copyright", "title", "frontmatter", "backmatter"]
    return not any(p in name for p in skip_patterns)


def _extract_chapter_title(text: str, fallback: str) -> str:
    """Try to find a heading at the start of the chapter text."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if lines:
        first = lines[0]
        # Accept short first lines as titles (typical chapter headings)
        if len(first) < 120 and not first.endswith((".", "?", "!")):
            return first
    return fallback


def parse_epub(file_bytes: bytes) -> ParsedBook:
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".epub", delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name
    try:
        book = epub.read_epub(tmp_path)
    finally:
        import os
        os.unlink(tmp_path)

    title = book.get_metadata("DC", "title")
    title = title[0][0] if title else "Unknown Title"

    author = book.get_metadata("DC", "creator")
    author = author[0][0] if author else "Unknown Author"

    # Get spine order
    spine_ids = [item_id for item_id, _ in book.spine]
    spine_items = []
    for item_id in spine_ids:
        item = book.get_item_with_id(item_id)
        if item and isinstance(item, epub.EpubHtml) and _is_content_chapter(item):
            spine_items.append(item)

    chapters: list[ParsedChapter] = []
    chapter_number = 1

    for item in spine_items:
        content = item.get_content().decode("utf-8", errors="replace")
        text = _html_to_text(content)

        # Skip very short items (likely just headings or empty pages)
        if len(text) < 200:
            continue

        fallback_title = f"Chapter {chapter_number}"
        chapter_title = _extract_chapter_title(text, fallback_title)

        chapters.append(ParsedChapter(
            number=chapter_number,
            title=chapter_title,
            raw_text=text,
        ))
        chapter_number += 1

    if not chapters:
        raise ValueError("No readable chapters found in EPUB")

    return ParsedBook(title=title, author=author, chapters=chapters)
