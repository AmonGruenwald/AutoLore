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

# Fuzzy-score thresholds
_FUZZY_CANDIDATE_MIN = 0.5   # minimum score to consider a book as a candidate
_FUZZY_HIGH_CONFIDENCE = 0.85  # score above which AI needs lower confidence to confirm
_FUZZY_LOW_CONFIDENCE = 0.6    # score above which AI needs higher confidence to confirm

# AI confidence thresholds per fuzzy tier
_AI_CONFIDENCE_HIGH_FUZZY = 0.7
_AI_CONFIDENCE_LOW_FUZZY = 0.85

# Excerpt length sent to AI
_EXCERPT_LENGTH = 500


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


def _book_excerpt(book: Book) -> str:
    first_chapter = book.chapters[0] if book.chapters else None
    return first_chapter.raw_text[:_EXCERPT_LENGTH] if first_chapter else ""


async def _ai_confirms_duplicate(
    api_key: str, model: str,
    title: str, author: str, excerpt: str,
    book: Book, min_confidence: float,
) -> dict | None:
    """Call AI duplicate check; return result dict or None if not confirmed."""
    ai_result = await check_duplicate_book(
        api_key, model,
        title, author, excerpt,
        book.title, book.author, _book_excerpt(book),
    )
    if ai_result.get("is_duplicate") and ai_result.get("confidence", 0) > min_confidence:
        return {
            "book": book,
            "confidence": ai_result["confidence"],
            "reasoning": ai_result["reasoning"],
        }
    return None


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

    # Stage 2: fuzzy string matching + AI confirmation
    candidates = [
        (score, book)
        for book in db.query(Book).all()
        if (score := _fuzzy_score(title, author, book.title, book.author)) > _FUZZY_CANDIDATE_MIN
    ]
    candidates.sort(reverse=True, key=lambda x: x[0])

    for score, book in candidates[:3]:
        if score > _FUZZY_HIGH_CONFIDENCE:
            min_confidence = _AI_CONFIDENCE_HIGH_FUZZY
        elif score > _FUZZY_LOW_CONFIDENCE:
            min_confidence = _AI_CONFIDENCE_LOW_FUZZY
        else:
            continue

        result = await _ai_confirms_duplicate(api_key, model, title, author, excerpt, book, min_confidence)
        if result:
            return result

    return None
