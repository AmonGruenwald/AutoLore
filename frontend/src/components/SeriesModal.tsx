import { useState, useEffect } from 'react'
import { X, GripVertical, Plus, Trash2 } from 'lucide-react'
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

  function addBook(bookId: number) {
    setSelectedIds(ids => [...ids, bookId])
  }

  function removeBook(bookId: number) {
    setSelectedIds(ids => ids.filter(id => id !== bookId))
  }

  function moveUp(index: number) {
    if (index === 0) return
    setSelectedIds(ids => {
      const arr = [...ids]
      ;[arr[index - 1], arr[index]] = [arr[index], arr[index - 1]]
      return arr
    })
  }

  function moveDown(index: number) {
    if (index === selectedIds.length - 1) return
    setSelectedIds(ids => {
      const arr = [...ids]
      ;[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]]
      return arr
    })
  }

  async function save() {
    if (!name.trim()) { setError('Series name is required'); return }
    if (selectedIds.length < 2) { setError('Select at least 2 books'); return }
    setSaving(true)
    try {
      if (series) {
        await updateSeries(series.id, name.trim(), selectedIds)
      } else {
        await createSeries(name.trim(), selectedIds)
      }
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-parchment-50 rounded-lg shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-4 border-b border-parchment-300">
          <h2 className="text-lg font-bold">{series ? 'Edit Series' : 'Create Series'}</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Series name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border border-parchment-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="e.g. The Lord of the Rings"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Books in series (ordered)</label>
            {selectedBooks.length === 0 ? (
              <p className="text-sm text-ink-muted italic">No books selected yet.</p>
            ) : (
              <ul className="space-y-1 mb-2">
                {selectedBooks.map((book, i) => (
                  <li key={book.id} className="flex items-center gap-2 bg-parchment-100 rounded px-2 py-1.5">
                    <span className="text-ink-muted text-xs w-5 text-center">{i + 1}</span>
                    <span className="flex-1 text-sm truncate">{book.title}</span>
                    <div className="flex gap-1">
                      <button onClick={() => moveUp(i)} disabled={i === 0} className="text-ink-muted hover:text-ink disabled:opacity-30">↑</button>
                      <button onClick={() => moveDown(i)} disabled={i === selectedIds.length - 1} className="text-ink-muted hover:text-ink disabled:opacity-30">↓</button>
                      <button onClick={() => removeBook(book.id)} className="text-red-500 hover:text-red-700"><Trash2 size={13} /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {availableBooks.length > 0 && (
              <div>
                <p className="text-xs text-ink-muted mb-1">Add book:</p>
                <div className="flex flex-wrap gap-1">
                  {availableBooks.map(book => (
                    <button
                      key={book.id}
                      onClick={() => addBook(book.id)}
                      className="flex items-center gap-1 text-xs border border-parchment-300 rounded px-2 py-1 hover:bg-parchment-200"
                    >
                      <Plus size={11} /> {book.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-parchment-300">
          <button onClick={onClose} className="px-4 py-1.5 text-sm rounded border border-parchment-300 hover:bg-parchment-200">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 text-sm rounded bg-ink text-parchment-100 hover:bg-ink-light disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
