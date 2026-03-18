import { BookOpen } from 'lucide-react'

interface Props {
  totalChapters: number
  value: number
  onChange: (chapter: number) => void
  chapterTitles?: { number: number; title: string }[]
}

export default function ChapterSlider({ totalChapters, value, onChange, chapterTitles }: Props) {
  const currentTitle = chapterTitles?.find(c => c.number === value)?.title

  return (
    <div className="border-b border-parchment-200 px-4 md:px-6 py-2 shrink-0">
      <div className="flex items-center gap-3">
        <BookOpen size={13} className="text-ink-muted shrink-0" />
        <input
          type="range"
          min={1}
          max={totalChapters}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="flex-1 accent-ink cursor-pointer h-1"
        />
        <span className="text-xs font-medium text-ink-muted tabular-nums whitespace-nowrap">
          {value} / {totalChapters}
        </span>
      </div>
      {currentTitle && (
        <p className="text-xs text-ink-muted mt-0.5 ml-5 truncate opacity-70 italic">
          {currentTitle}
        </p>
      )}
    </div>
  )
}
