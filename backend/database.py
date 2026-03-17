from sqlalchemy import (
    create_engine, Column, Integer, String, Text, ForeignKey,
    DateTime, JSON, Boolean, Float, event
)
from sqlalchemy import text as _text
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from datetime import datetime
import os

DB_PATH = os.environ.get("DB_PATH", "./autolore.db")
engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={
        "check_same_thread": False,
        "timeout": 30,  # wait up to 30s before giving up on a lock
    },
)

@event.listens_for(engine, "connect")
def _set_sqlite_pragma(conn, _):
    conn.execute("PRAGMA journal_mode=WAL")   # concurrent reads during writes
    conn.execute("PRAGMA synchronous=NORMAL") # safe + faster than FULL with WAL

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class Series(Base):
    __tablename__ = "series"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    book_order = Column(JSON, default=list)  # ordered list of book ids
    created_at = Column(DateTime, default=datetime.utcnow)

    books = relationship("Book", back_populates="series")


class Book(Base):
    __tablename__ = "books"
    id = Column(Integer, primary_key=True)
    title = Column(String, nullable=False)
    author = Column(String, default="")
    filename = Column(String, nullable=False)
    content_hash = Column(String, unique=True, nullable=False)  # SHA-256 of epub bytes
    total_chapters = Column(Integer, default=0)
    series_id = Column(Integer, ForeignKey("series.id"), nullable=True)
    series_order = Column(Integer, nullable=True)  # position within series
    generation_status = Column(String, default="pending")  # pending|processing|done|error
    generation_progress = Column(Integer, default=0)  # chapters processed
    stop_chapter = Column(Integer, nullable=True)     # pause after this story-chapter index (1-based); None = no stop
    generation_step = Column(String, nullable=True)   # human-readable current step
    generation_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    series = relationship("Series", back_populates="books")
    chapters = relationship("Chapter", back_populates="book", cascade="all, delete-orphan")
    wiki_pages = relationship("WikiPage", back_populates="book", cascade="all, delete-orphan")


class Chapter(Base):
    __tablename__ = "chapters"
    id = Column(Integer, primary_key=True)
    book_id = Column(Integer, ForeignKey("books.id"), nullable=False)
    number = Column(Integer, nullable=False)  # 1-indexed, original epub order
    title = Column(String, default="")
    raw_text = Column(Text, nullable=False)
    is_story_chapter = Column(Boolean, nullable=True)  # None = unclassified
    clean_title = Column(String, nullable=True)        # AI-generated descriptive title

    book = relationship("Book", back_populates="chapters")


class WikiPage(Base):
    __tablename__ = "wiki_pages"
    id = Column(Integer, primary_key=True)
    book_id = Column(Integer, ForeignKey("books.id"), nullable=False)
    page_type = Column(String, nullable=False)  # summary|character|place|event
    slug = Column(String, nullable=False)  # url-safe identifier
    title = Column(String, nullable=False)

    book = relationship("Book", back_populates="wiki_pages")
    versions = relationship(
        "WikiPageVersion", back_populates="page",
        cascade="all, delete-orphan", order_by="WikiPageVersion.first_visible_chapter"
    )


class WikiPageVersion(Base):
    __tablename__ = "wiki_page_versions"
    id = Column(Integer, primary_key=True)
    page_id = Column(Integer, ForeignKey("wiki_pages.id"), nullable=False)
    first_visible_chapter = Column(Integer, nullable=False)  # chapter that introduced/updated this
    content_markdown = Column(Text, nullable=False)
    # links: list of {"text": "...", "slug": "...", "page_type": "..."}
    outgoing_links = Column(JSON, default=list)

    page = relationship("WikiPage", back_populates="versions")


class Setting(Base):
    __tablename__ = "settings"
    key = Column(String, primary_key=True)
    value = Column(Text, nullable=False)


def init_db():
    Base.metadata.create_all(bind=engine)
    _run_migrations()


def _run_migrations():
    """Apply any schema changes that create_all won't handle on existing databases."""
    migrations = [
        "ALTER TABLE books ADD COLUMN generation_step TEXT",
        "ALTER TABLE chapters ADD COLUMN is_story_chapter INTEGER",
        "ALTER TABLE chapters ADD COLUMN clean_title TEXT",
        "ALTER TABLE books ADD COLUMN stop_chapter INTEGER",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(_text(sql))
                conn.commit()
            except Exception:
                pass  # column already exists — safe to ignore

