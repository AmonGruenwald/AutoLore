import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, BookOpen, Trash2, RotateCw, Library, AlertTriangle, X } from 'lucide-react'
import { getBooks, deleteBook, regenerateWiki, uploadBook, confirmDuplicateUpload, getSeries, deleteSeries } from '../lib/api'
import type { Book, Series, UploadResult } from '../lib/api'
import GenerationStatus from '../components/GenerationStatus'
import SeriesModal from '../components/SeriesModal'

export default function Home() {
  const [books, setBooks] = useState<Book[]>([])
  const [series, setSeries] = useState<Series[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [duplicateInfo, setDuplicateInfo] = useState<(UploadResult & { _file: File }) | null>(null)
  const [showSeriesModal, setShowSeriesModal] = useState(false)
  const [editingSeries, setEditingSeries] = useState<Series | undefined>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    const [b, s] = await Promise.all([getBooks(), getSeries()])
    setBooks(b)
    setSeries(s)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Poll while any book is processing
  useEffect(() => {
    const isProcessing = books.some(b => b.generation_status === 'processing')
    if (isProcessing && !pollingRef.current) {
      pollingRef.current = setInterval(load, 3000)
    } else if (!isProcessing && pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [books, load])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setError('')
    setUploading(true)
    try {
      const result = await uploadBook(file)
      if (result.status === 'duplicate_found') {
        setDuplicateInfo({ ...result, _file: file })
      } else {
        await load()
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleConfirmDuplicate() {
    if (!duplicateInfo) return
    setUploading(true)
    try {
      await confirmDuplicateUpload(duplicateInfo._file)
      setDuplicateInfo(null)
      await load()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this book and its wiki?')) return
    await deleteBook(id)
    await load()
  }

  async function handleRegenerate(id: number) {
    await regenerateWiki(id)
    await load()
  }

  const standaloneBooks = books.filter(b => !b.series_id)

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-ink">Your Library</h1>
        <div className="flex gap-2">
          <button
            onClick={() => { setEditingSeries(undefined); setShowSeriesModal(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-parchment-400 hover:bg-parchment-200 transition-colors"
          >
            <Library size={15} /> New Series
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded bg-ink text-parchment-100 hover:bg-ink-light disabled:opacity-50 transition-colors"
          >
            <Upload size={15} />
            {uploading ? 'Uploading...' : 'Import EPUB'}
          </button>
          <input ref={fileInputRef} type="file" accept=".epub" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 rounded px-4 py-2 text-sm">
          <AlertTriangle size={14} /> {error}
          <button onClick={() => setError('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* Duplicate detection dialog */}
      {duplicateInfo && (
        <div className="mb-6 bg-amber-50 border border-amber-300 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-amber-900">Possible duplicate detected</p>
              <p className="text-sm text-amber-800 mt-1">
                <strong>"{duplicateInfo.parsed_title}"</strong> appears to match the already-imported book{' '}
                <strong>"{duplicateInfo.existing_title}"</strong>{' '}
                ({Math.round((duplicateInfo.confidence ?? 0) * 100)}% confidence).
              </p>
              {duplicateInfo.reasoning && (
                <p className="text-xs text-amber-700 mt-1 italic">"{duplicateInfo.reasoning}"</p>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setDuplicateInfo(null)}
                  className="px-3 py-1 text-sm rounded border border-amber-400 hover:bg-amber-100"
                >
                  Cancel
                </button>
                <button
                  onClick={() => navigate(`/book/${duplicateInfo.existing_book_id}`)}
                  className="px-3 py-1 text-sm rounded border border-amber-400 hover:bg-amber-100"
                >
                  Open existing book
                </button>
                <button
                  onClick={handleConfirmDuplicate}
                  disabled={uploading}
                  className="px-3 py-1 text-sm rounded bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  Import anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Series */}
      {series.map(s => {
        const seriesBooks = s.book_order
          .map(id => books.find(b => b.id === id))
          .filter(Boolean) as Book[]
        return (
          <div key={s.id} className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Library size={16} className="text-ink-muted" />
              <h2 className="font-bold text-lg">{s.name}</h2>
              <button
                onClick={() => { setEditingSeries(s); setShowSeriesModal(true) }}
                className="text-xs text-ink-muted hover:text-ink ml-2"
              >Edit</button>
              <button
                onClick={async () => { if (confirm(`Delete series "${s.name}"?`)) { await deleteSeries(s.id); await load() } }}
                className="text-xs text-red-400 hover:text-red-600"
              >Delete</button>
              <button
                onClick={() => navigate(`/series/${s.id}`)}
                className="ml-auto px-3 py-1 text-xs rounded bg-ink text-parchment-100 hover:bg-ink-light"
              >
                Open Series Wiki →
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {seriesBooks.map((book, i) => (
                <BookCard key={book.id} book={book} seriesOrder={i + 1}
                  onOpen={() => navigate(`/book/${book.id}`)}
                  onDelete={() => handleDelete(book.id)}
                  onRegenerate={() => handleRegenerate(book.id)}
                />
              ))}
            </div>
          </div>
        )
      })}

      {/* Standalone books */}
      {standaloneBooks.length > 0 && (
        <>
          {series.length > 0 && <h2 className="font-bold text-lg mb-3">Standalone Books</h2>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {standaloneBooks.map(book => (
              <BookCard key={book.id} book={book}
                onOpen={() => navigate(`/book/${book.id}`)}
                onDelete={() => handleDelete(book.id)}
                onRegenerate={() => handleRegenerate(book.id)}
              />
            ))}
          </div>
        </>
      )}

      {books.length === 0 && (
        <div className="text-center py-20 text-ink-muted">
          <BookOpen size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-lg">No books imported yet.</p>
          <p className="text-sm mt-1">Click "Import EPUB" to get started.</p>
        </div>
      )}

      {showSeriesModal && (
        <SeriesModal
          books={books}
          series={editingSeries}
          onClose={() => setShowSeriesModal(false)}
          onSaved={load}
        />
      )}
    </div>
  )
}

function BookCard({
  book, seriesOrder, onOpen, onDelete, onRegenerate,
}: {
  book: Book
  seriesOrder?: number
  onOpen: () => void
  onDelete: () => void
  onRegenerate: () => void
}) {
  return (
    <div className="bg-parchment-50 border border-parchment-300 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h3 className="font-bold text-base leading-tight">
          {seriesOrder && <span className="text-ink-muted mr-1">#{seriesOrder}</span>}
          {book.title}
        </h3>
      </div>
      {book.author && <p className="text-xs text-ink-muted mb-2">{book.author}</p>}
      <p className="text-xs text-ink-muted mb-3">{book.total_chapters} chapters</p>
      <GenerationStatus book={book} />
      <div className="flex gap-1.5 mt-3">
        <button
          onClick={onOpen}
          disabled={book.generation_status !== 'done'}
          className="flex-1 text-xs py-1.5 rounded bg-ink text-parchment-100 hover:bg-ink-light disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Open Wiki
        </button>
        <button
          onClick={onRegenerate}
          title="Regenerate wiki"
          className="p-1.5 rounded border border-parchment-300 hover:bg-parchment-200 text-ink-muted"
        >
          <RotateCw size={13} />
        </button>
        <button
          onClick={onDelete}
          title="Delete book"
          className="p-1.5 rounded border border-red-200 hover:bg-red-50 text-red-400"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}
