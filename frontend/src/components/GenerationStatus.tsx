import { Loader2, CheckCircle, AlertCircle, Clock } from 'lucide-react'
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

  if (status === 'processing') {
    const pct = total_chapters > 0 ? Math.round((progress / total_chapters) * 100) : 0
    return (
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-1 text-amber-700 text-xs">
          <Loader2 size={12} className="animate-spin" />
          Generating wiki... {progress}/{total_chapters} chapters
        </span>
        <div className="w-full bg-parchment-200 rounded-full h-1.5">
          <div
            className="bg-amber-600 h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    )
  }

  return (
    <span className="flex items-center gap-1 text-ink-muted text-xs">
      <Clock size={12} /> Pending generation
    </span>
  )
}
