import { Loader2, CheckCircle2, AlertCircle, PauseCircle, ListChecks } from 'lucide-react'
import type { Book } from '../lib/api'

export default function GenerationStatus({ book }: { book: Book }) {
  const { generation_status: status, generation_progress: progress, total_chapters } = book

  if (status === 'selecting') {
    return book.generation_step ? (
      <span className="flex items-center gap-1 text-xs text-ink-muted">
        <Loader2 size={11} className="animate-spin shrink-0 text-amber-500" />
        Generating previews…
      </span>
    ) : (
      <span className="flex items-center gap-1 text-xs text-amber-700">
        <ListChecks size={11} className="shrink-0" />
        Select chapters
      </span>
    )
  }

  if (status === 'done') {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-600">
        <CheckCircle2 size={11} className="shrink-0" />
        Ready
      </span>
    )
  }

  if (status === 'error') {
    return (
      <span className="flex items-center gap-1 text-xs text-red-500">
        <AlertCircle size={11} className="shrink-0" />
        Failed
      </span>
    )
  }

  if (status === 'waiting') {
    return (
      <span className="flex items-center gap-1 text-xs text-ink-muted tabular-nums">
        <PauseCircle size={11} className="shrink-0" />
        {progress}/{total_chapters}
      </span>
    )
  }

  if (status === 'processing') {
    const pct = total_chapters > 0 ? Math.round((progress / total_chapters) * 100) : 0
    return (
      <div className="flex flex-col gap-1 min-w-0 w-full">
        <span className="flex items-center gap-1 text-xs text-ink-muted tabular-nums">
          <Loader2 size={11} className="animate-spin shrink-0 text-amber-500" />
          {progress}/{total_chapters}
          {book.generation_step && (
            <span className="truncate opacity-70 ml-1">{book.generation_step}</span>
          )}
        </span>
        <div className="w-full bg-parchment-300 rounded-full h-0.5">
          <div
            className="bg-amber-500 h-0.5 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    )
  }

  // pending
  return (
    <span className="flex items-center gap-1 text-xs text-ink-muted/60">
      Queued
    </span>
  )
}
