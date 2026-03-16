"""
Two-stage duplicate detection:
1. SHA-256 hash (exact match)
2. Fuzzy string similarity + AI confirmation for ambiguous cases
"""
import hashlib
import re
from difflib import SequenceMatcher
from sqlalchemy.orm import Session
from database import Book
from ai_service import check_duplicate_book


def compute_hash(file_bytes: bytes) -> str:
    return hashlib.sha256(file_bytes).hexdigest()


def _normalize(text: str) -> str:
    return re.sub(r"[^\w\s]", "", text.lower()).strip()


def _string_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, _normalize(a), _normalize(b)).ratio()


def _fuzzy_score(candidate_title: str, candidate_author: str,
                 existing_title: str, existing_author: str) -> float:
    title_sim = _string_similarity(candidate_title, existing_title)
    author_sim = _string_similarity(candidate_author, existing_author) if existing_author else 0.5
    return title_sim * 0.7 + author_sim * 0.3


async def find_duplicate(
    db: Session,
    content_hash: str,
    title: str,
    author: str,
    excerpt: str,
    api_key: str,
    model: str,
) -> dict | None:
    """
    Returns None if no duplicate found.
    Returns {"book": Book, "confidence": float, "reasoning": str} if duplicate found.
    """
    # Stage 1: exact hash match
    exact = db.query(Book).filter_by(content_hash=content_hash).first()
    if exact:
        return {"book": exact, "confidence": 1.0, "reasoning": "Identical file (SHA-256 match)"}

    # Stage 2: fuzzy string matching
    all_books = db.query(Book).all()
    candidates = []
    for book in all_books:
        score = _fuzzy_score(title, author, book.title, book.author)
        if score > 0.5:
            candidates.append((score, book))

    candidates.sort(reverse=True, key=lambda x: x[0])

    for score, book in candidates[:3]:
        if score > 0.85:
            # High confidence fuzzy match — confirm with AI
            first_chapter = book.chapters[0] if book.chapters else None
            existing_excerpt = first_chapter.raw_text[:500] if first_chapter else ""

            ai_result = await check_duplicate_book(
                api_key, model,
                title, author, excerpt,
                book.title, book.author, existing_excerpt,
            )
            if ai_result.get("is_duplicate") and ai_result.get("confidence", 0) > 0.7:
                return {
                    "book": book,
                    "confidence": ai_result["confidence"],
                    "reasoning": ai_result["reasoning"],
                }
        elif score > 0.6:
            # Lower confidence — still ask AI
            first_chapter = book.chapters[0] if book.chapters else None
            existing_excerpt = first_chapter.raw_text[:500] if first_chapter else ""

            ai_result = await check_duplicate_book(
                api_key, model,
                title, author, excerpt,
                book.title, book.author, existing_excerpt,
            )
            if ai_result.get("is_duplicate") and ai_result.get("confidence", 0) > 0.85:
                return {
                    "book": book,
                    "confidence": ai_result["confidence"],
                    "reasoning": ai_result["reasoning"],
                }

    return None
