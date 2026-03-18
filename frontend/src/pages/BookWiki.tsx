import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, AlertCircle, Loader2, Trash2, Menu, ChevronRight, Clock, MessageCircle, Network } from 'lucide-react'
import { getBook, getWikiPages, getWikiPage, deleteBook, continueProcessing, setStopChapter, deleteWikiPage, mergeWikiPages, updateWikiPage } from '../lib/api'
import type { BookDetail, WikiPageList, WikiPageContent } from '../lib/api'
import ChapterSlider from '../components/ChapterSlider'
import WikiSidebar from '../components/WikiSidebar'
import WikiPageComponent from '../components/WikiPage'
import WikiHome from '../components/WikiHome'
import AskPanel from '../components/AskPanel'
import GenerationStatus from '../components/GenerationStatus'
import CharacterGraph from '../components/CharacterGraph'

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
  const [stopChapterInput, setStopChapterInput] = useState<string>('')
  const [merging, setMerging] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)

  useEffect(() => {
    getBook(id).then(b => {
      setBook(b)
      setStopChapterInput(b.stop_chapter != null ? String(b.stop_chapter) : '')
      const defaultChapter = b.generation_status === 'done' ? b.total_chapters : b.generation_progress
      setChapter(Math.max(1, defaultChapter))
    }).catch(() => setError('Book not found'))
  }, [id])

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

  const maxChapter = book
    ? (book.generation_status === 'done' ? book.total_chapters : book.generation_progress)
    : 1
  const effectiveChapter = Math.min(chapter, Math.max(1, maxChapter))

  const canBrowse = book &&
    (book.generation_status === 'done' || book.generation_status === 'processing' || book.generation_status === 'waiting') &&
    maxChapter >= 1

  const loadPages = useCallback(() => {
    if (!canBrowse) return
    getWikiPages(id, effectiveChapter).then(setPages)
  }, [id, effectiveChapter, canBrowse])

  useEffect(() => { loadPages() }, [loadPages])

  // Set of slugs visible at the current chapter
  const visibleSlugSet = useMemo(() => {
    if (!pages) return new Set<string>()
    return new Set([
      ...pages.summaries.map(p => p.slug),
      ...pages.characters.map(p => p.slug),
      ...pages.places.map(p => p.slug),
      ...pages.events.map(p => p.slug),
    ])
  }, [pages])

  // Fetch the selected page — skip if slug isn't visible at this chapter
  useEffect(() => {
    if (!selectedSlug) return
    if (pages !== null && !visibleSlugSet.has(selectedSlug)) {
      setCurrentPage(null)
      return
    }
    setLoadingPage(true)
    getWikiPage(id, selectedSlug, effectiveChapter)
      .then(setCurrentPage)
      .catch(() => setCurrentPage(null))
      .finally(() => setLoadingPage(false))
  }, [id, selectedSlug, effectiveChapter, visibleSlugSet, pages])

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

  async function handleDeletePage() {
    if (!currentPage) return
    await deleteWikiPage(id, currentPage.slug)
    setCurrentPage(null)
    setSelectedSlug(null)
    loadPages()
  }

  async function handleMergePage(targetSlug: string) {
    if (!currentPage) return
    setMerging(true)
    try {
      const merged = await mergeWikiPages(id, currentPage.slug, targetSlug)
      setCurrentPage(merged)
      loadPages()
    } finally {
      setMerging(false)
    }
  }

  async function handleEditPage(title: string, content: string) {
    if (!currentPage) return
    const updated = await updateWikiPage(id, currentPage.slug, title, content, effectiveChapter)
    setCurrentPage(updated)
    if (updated.slug !== currentPage.slug) {
      setSelectedSlug(updated.slug)
    }
    loadPages()
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <AlertCircle size={28} className="mx-auto mb-2 text-red-400" />
        <p className="text-sm text-red-600">{error}</p>
        <button onClick={() => navigate('/')} className="mt-4 text-xs underline text-ink-muted">Back to library</button>
      </div>
    )
  }

  if (!book) {
    return (
      <div className="p-8 text-center">
        <Loader2 size={20} className="animate-spin mx-auto text-ink-muted" />
      </div>
    )
  }

  const isProcessing = book.generation_status === 'processing'
  const isWaiting = book.generation_status === 'waiting'
  const isPendingOrError = book.generation_status === 'pending' || book.generation_status === 'error'

  // Is the selected page known but not yet visible at this chapter?
  const pageNotYetVisible = selectedSlug !== null && pages !== null && !visibleSlugSet.has(selectedSlug)

  // Title of the selected entity if we can derive it (from currentPage or visibleSlugs)
  const selectedTitle = currentPage?.title ?? selectedSlug?.replace(/-/g, ' ') ?? ''

  return (
    <div className="flex flex-col h-[calc(100vh-48px)]">

      {/* Book header */}
      <div className="bg-parchment-50 border-b border-parchment-200 px-4 md:px-6 py-2.5 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="text-ink-muted hover:text-ink transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            onClick={() => { setSidebarOpen(v => !v); setGraphOpen(false) }}
            className="md:hidden text-ink-muted hover:text-ink"
          >
            <Menu size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-sm leading-tight truncate">{book.title}</h1>
            {book.author && <p className="text-xs text-ink-muted truncate">{book.author}</p>}
          </div>
          {!isProcessing && <GenerationStatus book={book} />}
          {canBrowse && (
            <>
              <button
                onClick={() => setGraphOpen(v => !v)}
                title="Character connection graph"
                className={`p-1.5 rounded-lg border transition-colors shrink-0 ${
                  graphOpen
                    ? 'bg-purple-50 border-purple-300 text-purple-600'
                    : 'border-parchment-200 text-ink-muted hover:bg-purple-50 hover:border-purple-200 hover:text-purple-500'
                }`}
              >
                <Network size={14} />
              </button>
              <button
                onClick={() => setAskOpen(v => !v)}
                title="Ask the wiki"
                className={`p-1.5 rounded-lg border transition-colors shrink-0 ${
                  askOpen
                    ? 'bg-amber-50 border-amber-300 text-amber-600'
                    : 'border-parchment-200 text-ink-muted hover:bg-amber-50 hover:border-amber-200 hover:text-amber-600'
                }`}
              >
                <MessageCircle size={14} />
              </button>
            </>
          )}
          <button
            onClick={handleDelete}
            title="Delete book and wiki"
            className="p-1.5 rounded-lg border border-parchment-200 text-ink-muted hover:bg-red-50 hover:border-red-200 hover:text-red-500 transition-colors shrink-0"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Processing indicator */}
      {isProcessing && (
        <div className="px-4 md:px-6 py-1.5 border-b border-parchment-200 flex items-center gap-2 text-xs text-ink-muted shrink-0">
          <Loader2 size={11} className="animate-spin shrink-0 text-amber-600" />
          <span>
            Processing chapter {book.generation_progress + 1} of {book.total_chapters}
            {book.generation_step && <span className="text-ink-muted/70"> · {book.generation_step}</span>}
          </span>
        </div>
      )}

      {/* Waiting — controls */}
      {isWaiting && (
        <div className="px-4 md:px-6 py-2 border-b border-parchment-200 flex flex-wrap items-center gap-x-4 gap-y-1.5 shrink-0">
          <span className="text-xs text-ink-muted">
            Chapter {book.generation_progress}/{book.total_chapters} done
          </span>
          <div className="flex items-center gap-3 ml-auto">
            <label className="flex items-center gap-1.5 text-xs text-ink-muted select-none">
              Stop at
              <input
                type="number"
                min={book.generation_progress + 1}
                max={book.total_chapters}
                value={stopChapterInput}
                placeholder="—"
                onChange={e => {
                  setStopChapterInput(e.target.value)
                  const val = e.target.value === '' ? null : Number(e.target.value)
                  setStopChapter(id, val).then(() => getBook(id).then(setBook))
                }}
                className="w-12 px-1.5 py-0.5 text-xs border border-parchment-300 rounded-md bg-white text-center focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoProcess}
                onChange={e => setAutoProcess(e.target.checked)}
                className="accent-ink"
              />
              Auto
            </label>
            <button
              onClick={handleContinue}
              disabled={continuing}
              className="flex items-center gap-1 px-3 py-1 text-xs rounded-lg bg-ink text-parchment-100 hover:bg-ink-light disabled:opacity-50 transition-colors"
            >
              {continuing ? <Loader2 size={11} className="animate-spin" /> : <ChevronRight size={11} />}
              Ch. {book.generation_progress + 1}
            </button>
          </div>
        </div>
      )}

      {/* Pending / error */}
      {isPendingOrError ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-ink-muted">
            {book.generation_status === 'error' ? (
              <>
                <AlertCircle size={28} className="mx-auto mb-2 text-red-400" />
                <p className="font-medium text-red-600 text-sm">Generation failed</p>
                <p className="text-xs mt-1 max-w-sm">{book.generation_error}</p>
              </>
            ) : (
              <>
                <Loader2 size={28} className="animate-spin mx-auto mb-2 opacity-40" />
                <p className="text-sm">Waiting — add an API key in Settings to begin.</p>
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
              onChange={c => setChapter(c)}
              chapterTitles={book.chapters}
            />
          )}

          <div className="relative flex flex-1 overflow-hidden" style={{ minWidth: 0 }}>
            {/* Character graph overlay */}
            {graphOpen && canBrowse && (
              <div className="absolute inset-0 z-30 flex flex-col">
                <CharacterGraph
                  bookId={id}
                  effectiveChapter={effectiveChapter}
                  pages={pages}
                  onNavigate={slug => { setSelectedSlug(slug); setGraphOpen(false) }}
                />
              </div>
            )}

            {sidebarOpen && (
              <div
                className="absolute inset-0 z-10 bg-black/20 md:hidden"
                onClick={() => setSidebarOpen(false)}
              />
            )}

            <aside className={[
              'absolute inset-y-0 left-0 z-20 transition-transform duration-200',
              'md:relative md:translate-x-0',
              'w-64 border-r border-parchment-200 bg-parchment-50 overflow-y-auto shrink-0 py-2',
              sidebarOpen ? 'translate-x-0' : '-translate-x-full',
            ].join(' ')}>
              {pages ? (
                <WikiSidebar
                  pages={pages}
                  selectedSlug={selectedSlug}
                  onSelect={slug => { setSelectedSlug(slug); setSidebarOpen(false) }}
                  onHome={() => { setSelectedSlug(null); setSidebarOpen(false) }}
                />
              ) : (
                <div className="p-4 text-center">
                  <Loader2 size={14} className="animate-spin mx-auto text-ink-muted" />
                </div>
              )}
            </aside>

            <main className="flex-1 overflow-y-auto p-5 md:p-8 lg:p-10">
              {/* Home / overview */}
              {!selectedSlug && book && (
                <WikiHome
                  book={book}
                  pages={pages}
                  effectiveChapter={effectiveChapter}
                  onNavigate={setSelectedSlug}
                />
              )}

              {/* Page not yet visible at this chapter */}
              {pageNotYetVisible && (
                <div className="flex flex-col items-center justify-center pt-24 text-center gap-3">
                  <Clock size={32} className="text-ink-muted/30" />
                  <p className="text-sm font-medium text-ink-muted">
                    {selectedTitle
                      ? <><span className="capitalize">{selectedTitle}</span> hasn&apos;t appeared yet</>
                      : "This page hasn\u2019t appeared yet"}
                  </p>
                  <p className="text-xs text-ink-muted/60 max-w-xs">
                    This entry hasn&apos;t been written at chapter {effectiveChapter}.
                    Move the slider forward to reveal it.
                  </p>
                </div>
              )}

              {/* Loading */}
              {selectedSlug && !pageNotYetVisible && loadingPage && (
                <div className="flex justify-center pt-16">
                  <Loader2 size={20} className="animate-spin text-ink-muted" />
                </div>
              )}

              {/* Page content */}
              {selectedSlug && !pageNotYetVisible && !loadingPage && currentPage && (
                <WikiPageComponent
                  page={currentPage}
                  onNavigate={setSelectedSlug}
                  visibleSlugs={visibleSlugSet}
                  sameTypePages={pages ? [
                    ...pages.summaries,
                    ...pages.characters,
                    ...pages.places,
                    ...pages.events,
                  ].filter(p => p.page_type === currentPage.page_type) : []}
                  onDelete={handleDeletePage}
                  onMerge={handleMergePage}
                  onEdit={handleEditPage}
                  merging={merging}
                />
              )}

              {/* Fallback — page loaded but empty */}
              {selectedSlug && !pageNotYetVisible && !loadingPage && !currentPage && (
                <div className="text-center text-ink-muted pt-16 text-sm">
                  {isProcessing && maxChapter < 1
                    ? 'First chapter still processing…'
                    : 'Select a page from the sidebar.'}
                </div>
              )}
            </main>

            {/* Ask panel */}
            {askOpen && canBrowse && (
              <AskPanel
                bookId={id}
                effectiveChapter={effectiveChapter}
                onClose={() => setAskOpen(false)}
                onNavigate={slug => { setSelectedSlug(slug); setSidebarOpen(false) }}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
