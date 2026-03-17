import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Loader2, GitMerge, Check, X, ArrowLeft, Pencil } from 'lucide-react'
import { getChapters, confirmChapterSelection } from '../lib/api'
import type { ChapterPreview } from '../lib/api'

export default function ChapterSelection() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
  const id = Number(bookId)

  const [chapters, setChapters] = useState<ChapterPreview[]>([])
  const [bookTitle, setBookTitle] = useState('')
  const [previewsReady, setPreviewsReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  const [included, setIncluded] = useState<Set<number>>(new Set())
  const [mergedWithNext, setMergedWithNext] = useState<Set<number>>(new Set())
  const [renames, setRenames] = useState<Map<number, string>>(new Map())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const data = await getChapters(id)
        setChapters(data.chapters)
        setBookTitle(data.title)
        const done = data.chapters.every(c => c.one_sentence_summary)
        setPreviewsReady(done)
        setIncluded(prev =>
          prev.size === 0 && data.chapters.length > 0
            ? new Set(data.chapters.map(c => c.id))
            : prev
        )
        setLoading(false)
        if (done && pollingRef.current) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
      } catch (e: any) {
        setError(e.message)
        setLoading(false)
      }
    }

    load()
    pollingRef.current = setInterval(async () => {
      try {
        const data = await getChapters(id)
        setChapters(data.chapters)
        if (data.chapters.every(c => c.one_sentence_summary)) {
          setPreviewsReady(true)
          clearInterval(pollingRef.current!)
          pollingRef.current = null
        }
      } catch {}
    }, 2000)

    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [id])

  function toggleInclude(chapterId: number) {
    setIncluded(prev => {
      const next = new Set(prev)
      next.has(chapterId) ? next.delete(chapterId) : next.add(chapterId)
      return next
    })
  }

  function toggleMerge(chapterId: number) {
    setMergedWithNext(prev => {
      const next = new Set(prev)
      next.has(chapterId) ? next.delete(chapterId) : next.add(chapterId)
      return next
    })
  }

  function startEdit(chapter: ChapterPreview) {
    setEditingId(chapter.id)
    setEditingValue(renames.get(chapter.id) ?? chapter.title)
    setTimeout(() => editInputRef.current?.select(), 0)
  }

  function commitEdit() {
    if (editingId === null) return
    const trimmed = editingValue.trim()
    const original = chapters.find(c => c.id === editingId)?.title ?? ''
    setRenames(prev => {
      const next = new Map(prev)
      trimmed && trimmed !== original ? next.set(editingId, trimmed) : next.delete(editingId)
      return next
    })
    setEditingId(null)
  }

  function cancelEdit() { setEditingId(null); setEditingValue('') }

  async function handleConfirm() {
    setConfirming(true)
    setError('')
    try {
      const selections = chapters.map(c => ({ id: c.id, include: included.has(c.id) }))
      const merges: number[][] = []
      for (let i = 0; i < chapters.length - 1; i++) {
        if (mergedWithNext.has(chapters[i].id)) merges.push([chapters[i].id, chapters[i + 1].id])
      }
      const renamesList = Array.from(renames.entries()).map(([chId, title]) => ({ id: chId, title }))
      await confirmChapterSelection(id, selections, merges, renamesList)
      navigate(`/book/${id}`)
    } catch (e: any) {
      setError(e.message)
      setConfirming(false)
    }
  }

  const includedCount = chapters.filter(c => included.has(c.id)).length
  const readyCount = chapters.filter(c => c.one_sentence_summary).length

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64 text-ink-muted gap-2">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">

      {/* Header */}
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink mb-6 transition-colors"
      >
        <ArrowLeft size={13} /> Library
      </button>

      <div className="mb-8">
        <h1 className="text-xl font-semibold text-ink">{bookTitle}</h1>
        <p className="text-sm text-ink-muted mt-1">
          Choose which chapters to include. Click a title to rename it, or use{' '}
          <span className="font-medium text-ink">Merge</span> to combine two consecutive chapters.
        </p>

        {/* Preview generation progress — single, subtle indicator */}
        {!previewsReady && (
          <p className="flex items-center gap-1.5 text-xs text-ink-muted mt-2">
            <Loader2 size={11} className="animate-spin shrink-0" />
            Generating summaries — {readyCount} of {chapters.length} ready
          </p>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-5">
          <X size={14} className="shrink-0" /> {error}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-4 mb-2 text-xs text-ink-muted">
        <button
          onClick={() => setIncluded(new Set(chapters.map(c => c.id)))}
          className="hover:text-ink transition-colors"
        >
          Select all
        </button>
        <button
          onClick={() => setIncluded(new Set())}
          className="hover:text-ink transition-colors"
        >
          None
        </button>
        <span className="ml-auto tabular-nums">
          {includedCount} / {chapters.length} selected
        </span>
      </div>

      {/* Chapter list */}
      <div className="rounded-xl border border-parchment-300 divide-y divide-parchment-200 overflow-hidden mb-8">
        {chapters.map((chapter, idx) => {
          const isIncluded = included.has(chapter.id)
          const isMergedOut = mergedWithNext.has(chapter.id)   // this chapter merges INTO next
          const isMergedIn  = idx > 0 && mergedWithNext.has(chapters[idx - 1].id) // absorbed from prev
          const isLast = idx === chapters.length - 1

          return (
            <div
              key={chapter.id}
              className={[
                'group relative transition-colors',
                isMergedIn ? 'border-l-2 border-l-amber-400' : '',
              ].join(' ')}
            >
              <div className={[
                'flex items-start gap-3 px-4 py-3.5',
                !isIncluded ? 'opacity-40' : '',
              ].join(' ')}>

                {/* Checkbox */}
                <button
                  onClick={() => toggleInclude(chapter.id)}
                  className={[
                    'mt-0.5 shrink-0 w-4.5 h-4.5 rounded border transition-colors flex items-center justify-center',
                    isIncluded
                      ? 'bg-ink border-ink'
                      : 'border-parchment-400 hover:border-ink-muted bg-white',
                  ].join(' ')}
                >
                  {isIncluded && <Check size={10} strokeWidth={3} className="text-parchment-50" />}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">

                  {/* Title row */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] text-ink-muted tabular-nums shrink-0 w-6 text-right">
                      {chapter.number}
                    </span>

                    {editingId === chapter.id ? (
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <input
                          ref={editInputRef}
                          value={editingValue}
                          onChange={e => setEditingValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitEdit()
                            if (e.key === 'Escape') cancelEdit()
                          }}
                          onBlur={commitEdit}
                          className="flex-1 min-w-0 text-sm font-medium bg-transparent border-b border-ink outline-none"
                        />
                        <button onClick={commitEdit} className="text-green-700 hover:text-green-900 shrink-0">
                          <Check size={13} strokeWidth={3} />
                        </button>
                        <button onClick={cancelEdit} className="text-ink-muted hover:text-ink shrink-0">
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(chapter)}
                        className="flex items-center gap-1.5 flex-1 min-w-0 text-left group/title"
                        title="Click to rename"
                      >
                        <span className="text-sm font-medium truncate">
                          {renames.get(chapter.id) ?? chapter.title}
                        </span>
                        {renames.has(chapter.id) && (
                          <span className="text-[10px] text-amber-600 shrink-0">edited</span>
                        )}
                        <Pencil
                          size={10}
                          className="shrink-0 text-ink-muted opacity-0 group-hover/title:opacity-100 transition-opacity"
                        />
                      </button>
                    )}
                  </div>

                  {/* Summary spoiler */}
                  {chapter.one_sentence_summary && (
                    <div className="ml-8 mt-0.5">
                      <details>
                        <summary className="cursor-pointer list-none text-xs text-ink-muted hover:text-ink transition-colors inline-flex items-center gap-1 select-none">
                          <span className="underline decoration-dotted underline-offset-2">Summary</span>
                        </summary>
                        <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                          {chapter.one_sentence_summary}
                        </p>
                      </details>
                    </div>
                  )}
                </div>

                {/* Merge button — always visible but subtle */}
                {!isLast && (
                  <button
                    onClick={() => toggleMerge(chapter.id)}
                    title={isMergedOut ? 'Undo merge' : 'Merge with next chapter'}
                    className={[
                      'shrink-0 mt-0.5 flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors',
                      isMergedOut
                        ? 'bg-amber-100 text-amber-700 border border-amber-300'
                        : 'text-ink-muted hover:text-ink border border-transparent hover:border-parchment-300',
                    ].join(' ')}
                  >
                    <GitMerge size={11} />
                    {isMergedOut ? 'Merged' : 'Merge'}
                  </button>
                )}
              </div>

              {/* Merge connector between this row and next */}
              {isMergedOut && (
                <div className="flex items-center gap-2 px-4 py-1 bg-amber-50 border-t border-amber-100">
                  <div className="w-6 flex justify-center shrink-0">
                    <div className="w-px h-3 bg-amber-300" />
                  </div>
                  <span className="text-[11px] text-amber-600 italic">combined with next</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => navigate('/')}
          className="text-sm text-ink-muted hover:text-ink transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={confirming || includedCount === 0}
          className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg bg-ink text-parchment-100 hover:bg-ink-light disabled:opacity-40 transition-colors"
        >
          {confirming && <Loader2 size={13} className="animate-spin" />}
          {confirming ? 'Starting…' : `Generate wiki — ${includedCount} chapter${includedCount !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  )
}
