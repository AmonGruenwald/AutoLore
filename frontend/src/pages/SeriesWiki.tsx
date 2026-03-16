import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react'
import { getBooks, getSeries, getSeriesWikiPages, getWikiPage } from '../lib/api'
import type { WikiPageList, WikiPageContent, Series, Book } from '../lib/api'
import WikiSidebar from '../components/WikiSidebar'
import WikiPageComponent from '../components/WikiPage'
import ChapterSlider from '../components/ChapterSlider'

export default function SeriesWiki() {
  const { seriesId } = useParams<{ seriesId: string }>()
  const navigate = useNavigate()
  const id = Number(seriesId)

  const [seriesList, setSeriesList] = useState<Series[]>([])
  const [books, setBooks] = useState<Book[]>([])
  const [globalChapter, setGlobalChapter] = useState(1)
  const [totalGlobalChapters, setTotalGlobalChapters] = useState(1)
  const [pages, setPages] = useState<WikiPageList | null>(null)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [selectedBookId, setSelectedBookId] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState<WikiPageContent | null>(null)
  const [loadingPage, setLoadingPage] = useState(false)

  const series = seriesList.find(s => s.id === id)

  useEffect(() => {
    Promise.all([getSeries(), getBooks()]).then(([s, b]) => {
      setSeriesList(s)
      setBooks(b)
      const ser = s.find(x => x.id === id)
      if (ser) {
        const total = ser.book_order
          .map(bid => b.find(bk => bk.id === bid)?.total_chapters ?? 0)
          .reduce((a, c) => a + c, 0)
        setTotalGlobalChapters(total)
        setGlobalChapter(total)
      }
    })
  }, [id])

  useEffect(() => {
    if (!series) return
    getSeriesWikiPages(id, globalChapter).then(p => {
      setPages(p)
      setSelectedSlug(null)
    })
  }, [id, globalChapter, series])

  useEffect(() => {
    if (pages && !selectedSlug && pages.summaries.length > 0) {
      const first = pages.summaries[0]
      setSelectedSlug(first.slug)
      setSelectedBookId(first.book_id ?? null)
    }
  }, [pages, selectedSlug])

  useEffect(() => {
    if (!selectedSlug || !selectedBookId) return
    // Compute local chapter offset
    const seriesData = seriesList.find(s => s.id === id)
    if (!seriesData) return
    let offset = 0
    for (const bid of seriesData.book_order) {
      if (bid === selectedBookId) break
      offset += books.find(b => b.id === bid)?.total_chapters ?? 0
    }
    const localChapter = Math.max(1, globalChapter - offset)

    setLoadingPage(true)
    getWikiPage(selectedBookId, selectedSlug, localChapter)
      .then(setCurrentPage)
      .catch(() => setCurrentPage(null))
      .finally(() => setLoadingPage(false))
  }, [selectedSlug, selectedBookId, globalChapter, id, seriesList, books])

  function handleSelect(slug: string, bookId?: number) {
    setSelectedSlug(slug)
    setSelectedBookId(bookId ?? null)
  }

  function handleNavigate(slug: string) {
    // Try to find which book this slug belongs to in current visible pages
    if (!pages) return
    const allPages = [...pages.summaries, ...pages.characters, ...pages.places, ...pages.events]
    const found = allPages.find(p => p.slug === slug)
    if (found) {
      setSelectedSlug(slug)
      setSelectedBookId(found.book_id ?? null)
    }
  }

  if (!series) {
    return <div className="p-8 text-center"><Loader2 size={24} className="animate-spin mx-auto" /></div>
  }

  return (
    <div className="flex flex-col h-[calc(100vh-48px)]">
      <div className="bg-parchment-50 border-b border-parchment-300 px-6 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-ink-muted hover:text-ink">
            <ArrowLeft size={18} />
          </button>
          <h1 className="font-bold text-lg">{series.name}</h1>
          <span className="text-xs text-ink-muted">Series Wiki</span>
        </div>
      </div>

      <ChapterSlider
        totalChapters={totalGlobalChapters}
        value={globalChapter}
        onChange={c => setGlobalChapter(c)}
      />

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 border-r border-parchment-300 bg-parchment-50 overflow-y-auto shrink-0 py-2">
          {pages ? (
            <WikiSidebar pages={pages} selectedSlug={selectedSlug} onSelect={handleSelect} />
          ) : (
            <div className="p-4 text-center"><Loader2 size={16} className="animate-spin mx-auto" /></div>
          )}
        </aside>

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
    </div>
  )
}
