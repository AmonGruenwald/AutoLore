import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, AlertCircle, Loader2, Trash2, Menu, ChevronRight } from 'lucide-react'
import { getBook, getWikiPages, getWikiPage, deleteBook, continueProcessing } from '../lib/api'
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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [autoProcess, setAutoProcess] = useState(false)
  const [continuing, setContinuing] = useState(false)

  // Load book info on mount
  useEffect(() => {
    getBook(id).then(b => {
      setBook(b)
      // Default to last available chapter
      const defaultChapter = b.generation_status === 'done'
        ? b.total_chapters
        : b.generation_progress
      setChapter(Math.max(1, defaultChapter))
    }).catch(() => setError('Book not found'))
  }, [id])

  // Poll while processing or waiting so the UI stays in sync
  useEffect(() => {
    if (!book) return
    if (book.generation_status !== 'processing' && book.generation_status !== 'waiting') return
    const interval = setInterval(() => {
      getBook(id).then(updated => {
        setBook(prev => {
          if (prev && updated.generation_progress > prev.generation_progress) {
            setChapter(c => c === prev.generation_progress ? updated.generation_progress : c)
          }
          return updated
        })
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [book?.generation_status, id])

  // Auto-process: when waiting and the toggle is on, kick off the next chapter automatically
  useEffect(() => {
    if (!book || book.generation_status !== 'waiting' || !autoProcess) return
    const t = setTimeout(() => {
      setContinuing(true)
      continueProcessing(id)
        .then(() => getBook(id).then(setBook))
        .catch(() => {})
        .finally(() => setContinuing(false))
    }, 600)
    return () => clearTimeout(t)
  }, [book?.generation_status, book?.generation_progress, autoProcess, id])

  // Max chapter the user can view right now
  const maxChapter = book
    ? (book.generation_status === 'done' ? book.total_chapters : book.generation_progress)
    : 1
  const effectiveChapter = Math.min(chapter, Math.max(1, maxChapter))

  // Load wiki page list whenever effective chapter or available chapters change
  const canBrowse = book &&
    (book.generation_status === 'done' || book.generation_status === 'processing' || book.generation_status === 'waiting') &&
    maxChapter >= 1

  const loadPages = useCallback(() => {
    if (!canBrowse) return
    getWikiPages(id, effectiveChapter).then(setPages)
  }, [id, effectiveChapter, canBrowse])

  useEffect(() => {
    loadPages()
  }, [loadPages])

  // Auto-select first summary on initial load
  useEffect(() => {
    if (pages && !selectedSlug && pages.summaries.length > 0) {
      setSelectedSlug(pages.summaries[0].slug)
    }
  }, [pages, selectedSlug])

  // Load selected page
  useEffect(() => {
    if (!selectedSlug) return
    setLoadingPage(true)
    getWikiPage(id, selectedSlug, effectiveChapter)
      .then(setCurrentPage)
      .catch(() => setCurrentPage(null))
      .finally(() => setLoadingPage(false))
  }, [id, selectedSlug, effectiveChapter])

  async function handleContinue() {
    if (!book) return
    setContinuing(true)
    try {
      await continueProcessing(id)
      getBook(id).then(setBook)
    } finally {
      setContinuing(false)
    }
  }

  async function handleDelete() {
    if (!book || !confirm(`Delete "${book.title}" and its entire wiki?`)) return
    await deleteBook(id)
    navigate('/')
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

  const isProcessing = book.generation_status === 'processing'
  const isWaiting = book.generation_status === 'waiting'
  const isPendingOrError = book.generation_status === 'pending' || book.generation_status === 'error'

  return (
    <div className="flex flex-col h-[calc(100vh-48px)]">
      {/* Book header */}
      <div className="bg-parchment-50 border-b border-parchment-300 px-4 md:px-6 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-ink-muted hover:text-ink">
            <ArrowLeft size={18} />
          </button>
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="md:hidden text-ink-muted hover:text-ink"
            aria-label="Toggle navigation"
          >
            <Menu size={18} />
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

      {/* In-progress banner */}
      {isProcessing && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 md:px-6 py-2 text-sm text-amber-800 flex items-center gap-2">
          <Loader2 size={13} className="animate-spin shrink-0" />
          <span>
            Processing chapter {book.generation_progress + 1} of {book.total_chapters}…
            {book.generation_step && <span className="text-amber-600"> {book.generation_step}</span>}
          </span>
        </div>
      )}

      {/* Waiting banner — chapter done, ready for next */}
      {isWaiting && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 md:px-6 py-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-amber-800">
            Chapter {book.generation_progress} of {book.total_chapters} done.
          </span>
          <div className="flex items-center gap-3 ml-auto">
            <label className="flex items-center gap-1.5 text-xs text-amber-700 cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={autoProcess}
                onChange={e => setAutoProcess(e.target.checked)}
                className="accent-amber-700"
              />
              Process all automatically
            </label>
            <button
              onClick={handleContinue}
              disabled={continuing}
              className="flex items-center gap-1 px-3 py-1 text-xs font-medium bg-amber-700 text-parchment-50 rounded hover:bg-amber-800 disabled:opacity-50 whitespace-nowrap"
            >
              {continuing
                ? <Loader2 size={11} className="animate-spin" />
                : <ChevronRight size={11} />}
              Process chapter {book.generation_progress + 1}
            </button>
          </div>
        </div>
      )}

      {/* Pending / error: centred message */}
      {isPendingOrError ? (
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
                <p>Waiting to generate — configure an API key in Settings.</p>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          {maxChapter >= 1 && (
            <ChapterSlider
              totalChapters={maxChapter}
              value={effectiveChapter}
              onChange={c => { setChapter(c); setSelectedSlug(null) }}
              chapterTitles={book.chapters}
            />
          )}

          <div className="relative flex flex-1 overflow-hidden">
            {/* Mobile backdrop */}
            {sidebarOpen && (
              <div
                className="absolute inset-0 z-10 bg-black/20 md:hidden"
                onClick={() => setSidebarOpen(false)}
              />
            )}

            {/* Sidebar — overlay on mobile, static on desktop */}
            <aside className={[
              'absolute inset-y-0 left-0 z-20 transition-transform duration-200',
              'md:relative md:translate-x-0',
              'w-56 border-r border-parchment-300 bg-parchment-50 overflow-y-auto shrink-0 py-2',
              sidebarOpen ? 'translate-x-0' : '-translate-x-full',
            ].join(' ')}>
              {pages ? (
                <WikiSidebar
                  pages={pages}
                  selectedSlug={selectedSlug}
                  onSelect={slug => { setSelectedSlug(slug); setSidebarOpen(false) }}
                />
              ) : (
                <div className="p-4 text-center"><Loader2 size={16} className="animate-spin mx-auto" /></div>
              )}
            </aside>

            {/* Main content */}
            <main className="flex-1 overflow-y-auto p-4 md:p-8">
              {loadingPage ? (
                <div className="flex justify-center pt-16"><Loader2 size={24} className="animate-spin" /></div>
              ) : currentPage ? (
                <WikiPageComponent
                  page={currentPage}
                  onNavigate={setSelectedSlug}
                  visibleSlugs={pages ? new Set([
                    ...pages.summaries.map(p => p.slug),
                    ...pages.characters.map(p => p.slug),
                    ...pages.places.map(p => p.slug),
                    ...pages.events.map(p => p.slug),
                  ]) : undefined}
                />
              ) : (
                <div className="text-center text-ink-muted pt-16">
                  {isProcessing && maxChapter < 1
                    ? <p>First chapter still processing...</p>
                    : <p>Select a page from the sidebar.</p>}
                </div>
              )}
            </main>
          </div>
        </>
      )}
    </div>
  )
}
