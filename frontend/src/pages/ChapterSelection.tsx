import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Loader2, GitMerge, Check, X, ArrowLeft } from 'lucide-react'
import { getChapters, confirmChapterSelection } from '../lib/api'
import type { ChapterPreview } from '../lib/api'

export default function ChapterSelection() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
  const id = Number(bookId)

  const [chapters, setChapters] = useState<ChapterPreview[]>([])
  const [bookTitle, setBookTitle] = useState('')
  const [generationStep, setGenerationStep] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  // included: set of chapter IDs the user wants to process
  const [included, setIncluded] = useState<Set<number>>(new Set())
  // mergedWithNext: set of chapter IDs that should be merged with the following chapter
  const [mergedWithNext, setMergedWithNext] = useState<Set<number>>(new Set())

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const data = await getChapters(id)
        setChapters(data.chapters)
        setBookTitle(data.title)
        setGenerationStep(data.generation_step)
        setIncluded(prev => {
          // Only initialise if not yet set
          if (prev.size === 0 && data.chapters.length > 0) {
            return new Set(data.chapters.map(c => c.id))
          }
          return prev
        })
        setLoading(false)

        const allDone = data.chapters.every(c => c.one_sentence_summary)
        if (allDone && pollingRef.current) {
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
        setGenerationStep(data.generation_step)
        if (data.chapters.every(c => c.one_sentence_summary)) {
          clearInterval(pollingRef.current!)
          pollingRef.current = null
          setGenerationStep(null)
        }
      } catch {}
    }, 2000)

    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [id])

  function toggleInclude(chapterId: number) {
    setIncluded(prev => {
      const next = new Set(prev)
      if (next.has(chapterId)) next.delete(chapterId)
      else next.add(chapterId)
      return next
    })
  }

  function toggleMerge(chapterId: number) {
    setMergedWithNext(prev => {
      const next = new Set(prev)
      if (next.has(chapterId)) next.delete(chapterId)
      else next.add(chapterId)
      return next
    })
  }

  async function handleConfirm() {
    setConfirming(true)
    setError('')
    try {
      const selections = chapters.map(c => ({ id: c.id, include: included.has(c.id) }))

      // Build merge pairs from mergedWithNext
      const merges: number[][] = []
      for (let i = 0; i < chapters.length - 1; i++) {
        if (mergedWithNext.has(chapters[i].id)) {
          merges.push([chapters[i].id, chapters[i + 1].id])
        }
      }

      await confirmChapterSelection(id, selections, merges)
      navigate(`/book/${id}`)
    } catch (e: any) {
      setError(e.message)
      setConfirming(false)
    }
  }

  const includedCount = chapters.filter(c => included.has(c.id)).length
  const allSelected = chapters.every(c => included.has(c.id))
  const noneSelected = chapters.every(c => !included.has(c.id))

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-ink-muted">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading chapters…
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink mb-4"
      >
        <ArrowLeft size={14} /> Back to library
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">{bookTitle}</h1>
        <p className="text-sm text-ink-muted mt-1">
          Select the chapters to include in the wiki. Toggle any off to skip them,
          or use <span className="font-medium">Merge ↓</span> to combine two consecutive chapters into one.
        </p>
      </div>

      {generationStep && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
          <Loader2 size={14} className="animate-spin shrink-0" />
          {generationStep}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
          <X size={14} /> {error}
        </div>
      )}

      {/* Bulk actions */}
      <div className="flex gap-2 mb-3 text-sm">
        <button
          onClick={() => setIncluded(new Set(chapters.map(c => c.id)))}
          disabled={allSelected}
          className="px-3 py-1 rounded border border-parchment-300 hover:bg-parchment-200 disabled:opacity-40"
        >
          Select all
        </button>
        <button
          onClick={() => setIncluded(new Set())}
          disabled={noneSelected}
          className="px-3 py-1 rounded border border-parchment-300 hover:bg-parchment-200 disabled:opacity-40"
        >
          Deselect all
        </button>
        <span className="ml-auto text-ink-muted self-center">
          {includedCount} of {chapters.length} chapters selected
        </span>
      </div>

      {/* Chapter list */}
      <div className="border border-parchment-300 rounded-lg overflow-hidden mb-6">
        {chapters.map((chapter, idx) => {
          const isIncluded = included.has(chapter.id)
          const isMerged = mergedWithNext.has(chapter.id)
          const isLastChapter = idx === chapters.length - 1
          // A chapter merged into from previous: show a visual indicator
          const isMergedFrom = idx > 0 && mergedWithNext.has(chapters[idx - 1].id)

          return (
            <div key={chapter.id}>
              {isMergedFrom && (
                <div className="flex items-center gap-2 px-4 py-1 bg-amber-50 border-t border-amber-200 text-xs text-amber-700">
                  <GitMerge size={12} /> Merged with previous chapter
                </div>
              )}
              <div
                className={[
                  'flex items-start gap-3 px-4 py-3 border-b border-parchment-200 last:border-b-0 transition-colors',
                  !isIncluded ? 'bg-parchment-100 opacity-50' : 'bg-white',
                  isMergedFrom ? 'border-l-2 border-l-amber-400' : '',
                ].join(' ')}
              >
                {/* Include toggle */}
                <button
                  onClick={() => toggleInclude(chapter.id)}
                  className={[
                    'mt-0.5 shrink-0 w-5 h-5 rounded flex items-center justify-center border transition-colors',
                    isIncluded
                      ? 'bg-ink border-ink text-parchment-100'
                      : 'border-parchment-400 hover:border-ink',
                  ].join(' ')}
                  title={isIncluded ? 'Exclude chapter' : 'Include chapter'}
                >
                  {isIncluded && <Check size={12} strokeWidth={3} />}
                </button>

                {/* Chapter info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-ink-muted shrink-0">#{chapter.number}</span>
                    <span className="font-medium text-sm truncate">{chapter.title}</span>
                  </div>
                  <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                    {chapter.one_sentence_summary ?? (
                      <span className="flex items-center gap-1">
                        <Loader2 size={10} className="animate-spin" /> Generating preview…
                      </span>
                    )}
                  </p>
                </div>

                {/* Merge button */}
                {!isLastChapter && (
                  <button
                    onClick={() => toggleMerge(chapter.id)}
                    title={isMerged ? 'Undo merge' : 'Merge with next chapter'}
                    className={[
                      'shrink-0 mt-0.5 flex items-center gap-1 px-2 py-0.5 rounded text-xs border transition-colors',
                      isMerged
                        ? 'bg-amber-100 border-amber-400 text-amber-800'
                        : 'border-parchment-300 text-ink-muted hover:border-amber-400 hover:text-amber-700',
                    ].join(' ')}
                  >
                    <GitMerge size={11} />
                    {isMerged ? 'Undo' : 'Merge ↓'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex justify-end gap-3">
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 text-sm rounded border border-parchment-300 hover:bg-parchment-200"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={confirming || includedCount === 0}
          className="px-5 py-2 text-sm rounded bg-ink text-parchment-100 hover:bg-ink-light disabled:opacity-50"
        >
          {confirming ? (
            <span className="flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Starting…</span>
          ) : (
            `Confirm & generate wiki (${includedCount} chapters)`
          )}
        </button>
      </div>
    </div>
  )
}
