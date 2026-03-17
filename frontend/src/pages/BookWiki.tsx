import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, AlertCircle, Loader2, Trash2 } from 'lucide-react'
import { getBook, getWikiPages, getWikiPage, deleteBook } from '../lib/api'
import type { BookDetail, WikiPageList, WikiPageContent } from '../lib/api'
import ChapterSlider from '../components/ChapterSlider'
import WikiSidebar from '../components/WikiSidebar'
import WikiPageComponent from '../components/WikiPage'
import GenerationStatus from '../components/GenerationStatus'

export default function BookWiki() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
  const id = Number(bookId)

  const [book, setBook] = useState<BookDetail | null>(null)
  const [chapter, setChapter] = useState(1)
  const [pages, setPages] = useState<WikiPageList | null>(null)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState<WikiPageContent | null>(null)
  const [loadingPage, setLoadingPage] = useState(false)
  const [error, setError] = useState('')

  // Load book info
  useEffect(() => {
    getBook(id).then(b => {
      setBook(b)
      setChapter(b.total_chapters) // default: fully read
    }).catch(() => setError('Book not found'))
  }, [id])

  // Load wiki page list whenever chapter changes
  useEffect(() => {
    if (!book || book.generation_status !== 'done') return
    getWikiPages(id, chapter).then(setPages)
  }, [id, chapter, book])

  // Auto-select first summary on load
  useEffect(() => {
    if (pages && !selectedSlug && pages.summaries.length > 0) {
      setSelectedSlug(pages.summaries[0].slug)
    }
  }, [pages, selectedSlug])

  // Load selected page
  useEffect(() => {
    if (!selectedSlug) return
    setLoadingPage(true)
    getWikiPage(id, selectedSlug, chapter)
      .then(setCurrentPage)
      .catch(() => setCurrentPage(null))
      .finally(() => setLoadingPage(false))
  }, [id, selectedSlug, chapter])

  async function handleDelete() {
    if (!book || !confirm(`Delete "${book.title}" and its entire wiki?`)) return
    await deleteBook(id)
    navigate('/')
  }

  function handleNavigate(slug: string) {
    setSelectedSlug(slug)
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <AlertCircle size={32} className="mx-auto mb-2 text-red-500" />
        <p className="text-red-600">{error}</p>
        <button onClick={() => navigate('/')} className="mt-4 text-sm underline">Back to library</button>
      </div>
    )
  }

  if (!book) {
    return <div className="p-8 text-center"><Loader2 size={24} className="animate-spin mx-auto" /></div>
  }

  return (
    <div className="flex flex-col h-[calc(100vh-48px)]">
      {/* Book header + progress */}
      <div className="bg-parchment-50 border-b border-parchment-300 px-6 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-ink-muted hover:text-ink">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="font-bold text-lg leading-tight">{book.title}</h1>
            {book.author && <p className="text-xs text-ink-muted">{book.author}</p>}
          </div>
          <GenerationStatus book={book} />
          <button
            onClick={handleDelete}
            title="Delete book and wiki"
            className="p-1.5 rounded border border-red-200 hover:bg-red-50 text-red-400 shrink-0"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {book.generation_status === 'done' && (
        <ChapterSlider
          totalChapters={book.total_chapters}
          value={chapter}
          onChange={c => { setChapter(c); setSelectedSlug(null) }}
          chapterTitles={book.chapters}
        />
      )}

      {book.generation_status !== 'done' ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-ink-muted">
            {book.generation_status === 'error' ? (
              <>
                <AlertCircle size={32} className="mx-auto mb-2 text-red-400" />
                <p className="font-semibold text-red-600">Wiki generation failed</p>
                <p className="text-sm mt-1">{book.generation_error}</p>
              </>
            ) : (
              <>
                <Loader2 size={32} className="animate-spin mx-auto mb-2" />
                <p>Wiki is being generated...</p>
                <p className="text-sm mt-1">{book.generation_progress}/{book.total_chapters} chapters processed</p>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <aside className="w-56 border-r border-parchment-300 bg-parchment-50 overflow-y-auto shrink-0 py-2">
            {pages ? (
              <WikiSidebar
                pages={pages}
                selectedSlug={selectedSlug}
                onSelect={setSelectedSlug}
              />
            ) : (
              <div className="p-4 text-center"><Loader2 size={16} className="animate-spin mx-auto" /></div>
            )}
          </aside>

          {/* Main content */}
          <main className="flex-1 overflow-y-auto p-8">
            {loadingPage ? (
              <div className="flex justify-center pt-16"><Loader2 size={24} className="animate-spin" /></div>
            ) : currentPage ? (
              <WikiPageComponent page={currentPage} onNavigate={handleNavigate} />
            ) : (
              <div className="text-center text-ink-muted pt-16">
                <p>Select a page from the sidebar.</p>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  )
}
