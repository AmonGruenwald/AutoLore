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
    <div className="bg-parchment-200 border-b border-parchment-300 px-4 md:px-6 py-3">
      <div className="flex items-center gap-3 max-w-2xl">
        <div className="flex items-center gap-1.5 text-sm font-medium text-ink-muted whitespace-nowrap">
          <BookOpen size={15} />
          <span className="hidden sm:inline">Reading progress:</span>
        </div>
        <input
          type="range"
          min={1}
          max={totalChapters}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="flex-1 accent-amber-700 cursor-pointer"
        />
        <div className="text-sm font-semibold text-ink whitespace-nowrap min-w-[80px] text-right">
          Ch. {value}/{totalChapters}
        </div>
      </div>
      {currentTitle && (
        <div className="text-xs text-ink-muted mt-1 italic truncate">
          "{currentTitle}"
        </div>
      )}
    </div>
  )
}
