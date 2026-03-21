import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, BookOpen, Trash2, RotateCw, Library, AlertTriangle, X, KeyRound, Loader2 } from 'lucide-react'
import { getBooks, deleteBook, regenerateWiki, uploadBook, confirmDuplicateUpload, getSeries, deleteSeries, getSettings } from '../lib/api'
import type { Book, Series, UploadResult, AppSettings } from '../lib/api'
import GenerationStatus from '../components/GenerationStatus'
import SeriesModal from '../components/SeriesModal'

export default function Home() {
  const [books, setBooks] = useState<Book[]>([])
  const [series, setSeries] = useState<Series[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [duplicateInfo, setDuplicateInfo] = useState<(UploadResult & { _file: File }) | null>(null)
  const [showSeriesModal, setShowSeriesModal] = useState(false)
  const [editingSeries, setEditingSeries] = useState<Series | undefined>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    const [b, s, cfg] = await Promise.all([getBooks(), getSeries(), getSettings()])
    setBooks(b)
    setSeries(s)
    setSettings(cfg)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const isProcessing = books.some(b => ['processing', 'pending', 'waiting', 'selecting'].includes(b.generation_status))
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

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-ink">Library</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setEditingSeries(undefined); setShowSeriesModal(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-ink-muted rounded-lg border border-parchment-300 hover:border-parchment-400 hover:text-ink transition-colors"
          >
            <Library size={13} /> New series
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg bg-ink text-parchment-100 hover:bg-ink-light disabled:opacity-50 transition-colors"
          >
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {uploading ? 'Uploading…' : 'Import EPUB'}
          </button>
          <input ref={fileInputRef} type="file" accept=".epub" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {/* API key notice */}
      {settings && !settings.openrouter_api_key_set && (
        <div className="mb-5 flex items-center gap-2 text-amber-800 border border-amber-200 bg-amber-50 rounded-lg px-4 py-2.5 text-sm">
          <KeyRound size={14} className="shrink-0" />
          <span>
            No API key set — wiki generation won't start until you{' '}
            <button onClick={() => navigate('/settings')} className="underline font-medium">
              add your OpenRouter key
            </button>.
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-5 flex items-center gap-2 text-red-700 border border-red-200 bg-red-50 rounded-lg px-4 py-2.5 text-sm">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600"><X size={14} /></button>
        </div>
      )}

      {/* Duplicate dialog */}
      {duplicateInfo && (
        <div className="mb-6 border border-amber-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Possible duplicate</p>
              <p className="text-sm text-ink-muted mt-1">
                <strong className="text-ink">"{duplicateInfo.parsed_title}"</strong> looks like{' '}
                <strong className="text-ink">"{duplicateInfo.existing_title}"</strong>{' '}
                ({Math.round((duplicateInfo.confidence ?? 0) * 100)}% match).
              </p>
              {duplicateInfo.reasoning && (
                <p className="text-xs text-ink-muted mt-1 italic">"{duplicateInfo.reasoning}"</p>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setDuplicateInfo(null)}
                  className="px-3 py-1 text-xs rounded-lg border border-parchment-300 hover:bg-parchment-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => navigate(`/book/${duplicateInfo.existing_book_id}`)}
                  className="px-3 py-1 text-xs rounded-lg border border-parchment-300 hover:bg-parchment-200 transition-colors"
                >
                  Open existing
                </button>
                <button
                  onClick={handleConfirmDuplicate}
                  disabled={uploading}
                  className="px-3 py-1 text-xs rounded-lg bg-ink text-parchment-100 hover:bg-ink-light disabled:opacity-50 transition-colors"
                >
                  Import anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Series sections */}
      {series.map(s => {
        const seriesBooks = s.book_order
          .map(id => books.find(b => b.id === id))
          .filter(Boolean) as Book[]
        return (
          <div key={s.id} className="mb-8">
            <div className="flex items-center gap-3 mb-3">
              <Library size={14} className="text-ink-muted shrink-0" />
              <h2 className="font-semibold text-sm">{s.name}</h2>
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <button
                  onClick={() => { setEditingSeries(s); setShowSeriesModal(true) }}
                  className="hover:text-ink transition-colors"
                >
                  Edit
                </button>
                <span>·</span>
                <button
                  onClick={async () => { if (confirm(`Delete series "${s.name}"?`)) { await deleteSeries(s.id); await load() } }}
                  className="hover:text-red-500 transition-colors"
                >
                  Delete
                </button>
              </div>
              <button
                onClick={() => navigate(`/series/${s.id}`)}
                className="ml-auto text-xs px-3 py-1 rounded-lg bg-ink text-parchment-100 hover:bg-ink-light transition-colors"
              >
                Series wiki →
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {seriesBooks.map((book, i) => (
                <BookCard
                  key={book.id}
                  book={book}
                  seriesOrder={i + 1}
                  onOpen={() => navigate(book.generation_status === 'selecting' ? `/book/${book.id}/select` : `/book/${book.id}`)}
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
          {series.length > 0 && (
            <h2 className="font-semibold text-sm mb-3 text-ink-muted">Standalone</h2>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {standaloneBooks.map(book => (
              <BookCard
                key={book.id}
                book={book}
                onOpen={() => navigate(book.generation_status === 'selecting' ? `/book/${book.id}/select` : `/book/${book.id}`)}
                onDelete={() => handleDelete(book.id)}
                onRegenerate={() => handleRegenerate(book.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* Empty state */}
      {books.length === 0 && (
        <div className="text-center py-24 text-ink-muted">
          <BookOpen size={40} className="mx-auto mb-4 opacity-20" strokeWidth={1.5} />
          <p className="text-sm font-medium">No books yet</p>
          <p className="text-xs mt-1 opacity-70">Click "Import EPUB" to get started.</p>
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
  const canOpen = ['done', 'processing', 'waiting', 'selecting', 'waiting_entity_selection'].includes(book.generation_status)

  return (
    <div className="bg-parchment-50 border border-parchment-200 rounded-xl p-4 flex flex-col gap-3 hover:border-parchment-400 transition-colors">
      {/* Title / author */}
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-sm leading-snug truncate">
          {seriesOrder && <span className="text-ink-muted mr-1 font-normal">#{seriesOrder}</span>}
          {book.title}
        </h3>
        {book.author && (
          <p className="text-xs text-ink-muted mt-0.5 truncate">{book.author}</p>
        )}
        <p className="text-xs text-ink-muted/70 mt-1">{book.total_chapters} chapters</p>
      </div>

      {/* Status */}
      <GenerationStatus book={book} />

      {/* Actions */}
      <div className="flex gap-1.5 mt-auto">
        {book.generation_status === 'selecting' ? (
          <button
            onClick={onOpen}
            className="flex-1 text-xs py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
          >
            Select chapters →
          </button>
        ) : (
          <button
            onClick={onOpen}
            disabled={!canOpen}
            className="flex-1 text-xs py-1.5 rounded-lg bg-ink text-parchment-100 hover:bg-ink-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Open wiki
          </button>
        )}
        <button
          onClick={onRegenerate}
          title="Regenerate wiki"
          className="p-1.5 rounded-lg border border-parchment-300 hover:bg-parchment-200 text-ink-muted transition-colors"
        >
          <RotateCw size={13} />
        </button>
        <button
          onClick={onDelete}
          title="Delete book"
          className="p-1.5 rounded-lg border border-parchment-200 hover:bg-red-50 hover:border-red-200 text-ink-muted hover:text-red-500 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}
