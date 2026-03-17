import { Loader2, CheckCircle, AlertCircle, Clock, PauseCircle } from 'lucide-react'
import type { Book } from '../lib/api'

interface Props {
  book: Book
}

export default function GenerationStatus({ book }: Props) {
  const { generation_status: status, generation_progress: progress, total_chapters } = book

  if (status === 'done') {
    return (
      <span className="flex items-center gap-1 text-green-700 text-xs">
        <CheckCircle size={12} /> Wiki ready
      </span>
    )
  }

  if (status === 'error') {
    return (
      <span className="flex items-center gap-1 text-red-600 text-xs">
        <AlertCircle size={12} /> Generation failed
      </span>
    )
  }

  if (status === 'waiting') {
    return (
      <span className="flex items-center gap-1 text-amber-600 text-xs whitespace-nowrap">
        <PauseCircle size={12} /> Ch. {progress}/{total_chapters}
      </span>
    )
  }

  if (status === 'processing') {
    const pct = total_chapters > 0 ? Math.round((progress / total_chapters) * 100) : 0
    return (
      <div className="flex flex-col gap-1 min-w-0">
        <span className="flex items-center gap-1 text-amber-700 text-xs whitespace-nowrap">
          <Loader2 size={12} className="animate-spin shrink-0" />
          Chapter {progress}/{total_chapters}
        </span>
        <div className="w-full bg-parchment-200 rounded-full h-1.5">
          <div
            className="bg-amber-600 h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        {book.generation_step && (
          <span className="text-xs text-ink-muted truncate max-w-xs" title={book.generation_step}>
            {book.generation_step}
          </span>
        )}
      </div>
    )
  }

  return (
    <span className="flex items-center gap-1 text-ink-muted text-xs">
      <Clock size={12} /> Waiting — configure API key in Settings to generate
    </span>
  )
}
