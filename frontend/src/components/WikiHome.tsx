import { useMemo } from 'react'
import { BookOpen, Users, MapPin, Zap, Loader2, BookOpenCheck } from 'lucide-react'
import type { BookDetail, WikiPageList, WikiPageSummary } from '../lib/api'

interface Props {
  book: BookDetail
  pages: WikiPageList | null
  effectiveChapter: number
  onNavigate: (slug: string) => void
}

const TYPE_CONFIG: Record<string, { color: string; bar: string; icon: React.ReactNode }> = {
  character: { color: 'text-purple-600', bar: 'bg-purple-400', icon: <Users size={12} /> },
  place:     { color: 'text-emerald-600', bar: 'bg-emerald-400', icon: <MapPin size={12} /> },
  event:     { color: 'text-orange-600', bar: 'bg-orange-400', icon: <Zap size={12} /> },
  summary:   { color: 'text-blue-600', bar: 'bg-blue-400', icon: <BookOpenCheck size={12} /> },
}

function RecentEntry({ entry, onNavigate }: { entry: WikiPageSummary; onNavigate: (slug: string) => void }) {
  const cfg = TYPE_CONFIG[entry.page_type] ?? TYPE_CONFIG.summary
  return (
    <button
      onClick={() => onNavigate(entry.slug)}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-parchment-200 transition-colors w-full text-left group"
    >
      <span className={`shrink-0 ${cfg.color}`}>{cfg.icon}</span>
      <span className="text-xs text-ink truncate group-hover:text-ink flex-1">{entry.title}</span>
      <span className="text-[10px] text-ink-muted/60 shrink-0">ch. {entry.last_updated_chapter}</span>
    </button>
  )
}

export default function WikiHome({ book, pages, effectiveChapter, onNavigate }: Props) {
  const totalProcessed = book.generation_status === 'done'
    ? book.total_chapters
    : book.generation_progress
  const progressPct = book.total_chapters > 0
    ? Math.round((totalProcessed / book.total_chapters) * 100)
    : 0
  const isProcessing = book.generation_status === 'processing'

  const charCount  = pages?.characters.length ?? 0
  const placeCount = pages?.places.length ?? 0
  const eventCount = pages?.events.length ?? 0
  const sumCount   = pages?.summaries.length ?? 0
  const maxCount   = Math.max(charCount, placeCount, eventCount, sumCount, 1)

  const recentEntries: WikiPageSummary[] = useMemo(() => {
    if (!pages) return []
    return [
      ...pages.characters,
      ...pages.places,
      ...pages.events,
    ]
      .sort((a, b) => b.last_updated_chapter - a.last_updated_chapter)
      .slice(0, 8)
  }, [pages])

  // Build the chapter grid — use book.chapters if available, else synthesise
  const allChapters = useMemo(() => {
    if (book.chapters.length > 0) return book.chapters
    return Array.from({ length: book.total_chapters }, (_, i) => ({
      number: i + 1,
      title: `Chapter ${i + 1}`,
    }))
  }, [book.chapters, book.total_chapters])

  return (
    <div className="max-w-2xl mx-auto space-y-8 py-2">

      {/* Book title */}
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <BookOpen size={16} className="text-amber-600 shrink-0" />
          <h2 className="text-xl font-bold text-ink font-serif leading-tight">{book.title}</h2>
        </div>
        {book.author && <p className="text-sm text-ink-muted pl-6">{book.author}</p>}
      </div>

      {/* Processing progress */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            {isProcessing ? 'Processing…' : book.generation_status === 'done' ? 'Complete' : 'Progress'}
          </span>
          <span className="text-xs text-ink-muted tabular-nums">
            {totalProcessed} / {book.total_chapters} chapters
          </span>
        </div>
        <div className="h-2.5 bg-parchment-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              isProcessing ? 'bg-amber-400' : 'bg-amber-600'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {isProcessing && book.generation_step && (
          <p className="text-[11px] text-ink-muted/70 mt-1.5 flex items-center gap-1">
            <Loader2 size={10} className="animate-spin shrink-0" />
            {book.generation_step}
          </p>
        )}
      </section>

      {/* Entity counts */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-3">
          Entities at chapter {effectiveChapter}
        </h3>
        <div className="space-y-2.5">
          {([
            ['Characters', charCount,  TYPE_CONFIG.character],
            ['Places',     placeCount, TYPE_CONFIG.place],
            ['Events',     eventCount, TYPE_CONFIG.event],
            ['Summaries',  sumCount,   TYPE_CONFIG.summary],
          ] as [string, number, typeof TYPE_CONFIG[string]][]).map(([label, count, cfg]) => (
            <div key={label} className="flex items-center gap-3">
              <div className={`flex items-center gap-1.5 w-24 shrink-0 ${cfg.color}`}>
                {cfg.icon}
                <span className="text-xs text-ink-muted">{label}</span>
              </div>
              <div className="flex-1 h-1.5 bg-parchment-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${cfg.bar}`}
                  style={{ width: count === 0 ? '0%' : `${Math.max(4, (count / maxCount) * 100)}%` }}
                />
              </div>
              <span className="text-xs font-medium text-ink w-5 text-right tabular-nums">{count}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Chapter grid */}
      {allChapters.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-3">
            Chapter map
          </h3>
          <div className="flex flex-wrap gap-1">
            {allChapters.map(ch => {
              const processed = ch.number <= totalProcessed
              const isCurrent = ch.number === effectiveChapter
              return (
                <div
                  key={ch.number}
                  title={ch.title || `Chapter ${ch.number}`}
                  className={[
                    'relative w-6 h-6 rounded text-[9px] font-mono flex items-center justify-center transition-all duration-300 select-none',
                    isCurrent
                      ? 'bg-amber-500 text-white ring-2 ring-amber-400 ring-offset-1 ring-offset-parchment-50 scale-110 z-10 font-bold'
                      : processed
                        ? 'bg-amber-200 text-amber-800 hover:bg-amber-300'
                        : 'bg-parchment-200 text-ink-muted/30',
                  ].join(' ')}
                >
                  {ch.number}
                </div>
              )
            })}
          </div>
          {/* Chapter title for current */}
          {allChapters.find(c => c.number === effectiveChapter)?.title && (
            <p className="mt-2 text-xs text-amber-700 font-medium pl-0.5">
              Ch. {effectiveChapter}: {allChapters.find(c => c.number === effectiveChapter)!.title}
            </p>
          )}
        </section>
      )}

      {/* Recently updated */}
      {recentEntries.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-2">
            Recently updated
          </h3>
          <div className="grid grid-cols-2 gap-0.5">
            {recentEntries.map(entry => (
              <RecentEntry key={entry.slug} entry={entry} onNavigate={onNavigate} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
