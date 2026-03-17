import { useState } from 'react'
import { X, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import type { Book, Series } from '../lib/api'
import { createSeries, updateSeries } from '../lib/api'

interface Props {
  books: Book[]
  series?: Series
  onClose: () => void
  onSaved: () => void
}

export default function SeriesModal({ books, series, onClose, onSaved }: Props) {
  const [name, setName] = useState(series?.name ?? '')
  const [selectedIds, setSelectedIds] = useState<number[]>(series?.book_order ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const availableBooks = books.filter(b => !selectedIds.includes(b.id))
  const selectedBooks = selectedIds
    .map(id => books.find(b => b.id === id))
    .filter(Boolean) as Book[]

  function addBook(bookId: number) { setSelectedIds(ids => [...ids, bookId]) }
  function removeBook(bookId: number) { setSelectedIds(ids => ids.filter(id => id !== bookId)) }

  function moveUp(i: number) {
    if (i === 0) return
    setSelectedIds(ids => { const a = [...ids]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a })
  }

  function moveDown(i: number) {
    if (i === selectedIds.length - 1) return
    setSelectedIds(ids => { const a = [...ids]; [a[i], a[i + 1]] = [a[i + 1], a[i]]; return a })
  }

  async function save() {
    if (!name.trim()) { setError('Series name is required'); return }
    if (selectedIds.length < 2) { setError('Select at least 2 books'); return }
    setSaving(true)
    try {
      series
        ? await updateSeries(series.id, name.trim(), selectedIds)
        : await createSeries(name.trim(), selectedIds)
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-parchment-50 rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-parchment-200">
          <h2 className="font-semibold text-sm">
            {series ? 'Edit series' : 'New series'}
          </h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-5 overflow-y-auto flex-1">

          {/* Name */}
          <div>
            <label className="block text-xs font-medium mb-1.5 text-ink-muted uppercase tracking-wide">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border border-parchment-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink-muted transition-colors"
              placeholder="e.g. The Lord of the Rings"
              autoFocus
            />
          </div>

          {/* Book order */}
          <div>
            <label className="block text-xs font-medium mb-1.5 text-ink-muted uppercase tracking-wide">
              Books in order
            </label>

            {selectedBooks.length === 0 ? (
              <p className="text-xs text-ink-muted italic py-2">No books added yet.</p>
            ) : (
              <ul className="space-y-1 mb-3">
                {selectedBooks.map((book, i) => (
                  <li
                    key={book.id}
                    className="flex items-center gap-2 bg-white border border-parchment-200 rounded-lg px-3 py-2"
                  >
                    <span className="text-xs text-ink-muted w-4 text-center shrink-0">{i + 1}</span>
                    <span className="flex-1 text-sm truncate">{book.title}</span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => moveUp(i)}
                        disabled={i === 0}
                        className="p-1 rounded text-ink-muted hover:text-ink disabled:opacity-20 transition-colors"
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        onClick={() => moveDown(i)}
                        disabled={i === selectedIds.length - 1}
                        className="p-1 rounded text-ink-muted hover:text-ink disabled:opacity-20 transition-colors"
                      >
                        <ChevronDown size={13} />
                      </button>
                      <button
                        onClick={() => removeBook(book.id)}
                        className="p-1 rounded text-ink-muted hover:text-red-500 transition-colors ml-1"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {availableBooks.length > 0 && (
              <div>
                <p className="text-xs text-ink-muted mb-1.5">Add a book:</p>
                <div className="flex flex-wrap gap-1.5">
                  {availableBooks.map(book => (
                    <button
                      key={book.id}
                      onClick={() => addBook(book.id)}
                      className="flex items-center gap-1 text-xs border border-parchment-300 rounded-lg px-2.5 py-1 hover:bg-parchment-200 hover:border-parchment-400 transition-colors"
                    >
                      <Plus size={10} /> {book.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-parchment-200">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-ink-muted hover:text-ink transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-1.5 text-sm rounded-lg bg-ink text-parchment-100 hover:bg-ink-light disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
