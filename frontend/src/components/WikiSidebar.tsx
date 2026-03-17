import { useState } from 'react'
import { ChevronDown, ChevronRight, User, MapPin, Zap, BookOpenCheck, LayoutDashboard } from 'lucide-react'
import type { WikiPageList, WikiPageSummary } from '../lib/api'

interface Props {
  pages: WikiPageList
  selectedSlug: string | null
  onSelect: (slug: string, bookId?: number) => void
  onHome: () => void
}

type Section = 'summaries' | 'characters' | 'places' | 'events'

const SECTION_CONFIG: Record<Section, { label: string; icon: React.ReactNode }> = {
  summaries:  { label: 'Chapters',    icon: <BookOpenCheck size={12} /> },
  characters: { label: 'Characters',  icon: <User size={12} /> },
  places:     { label: 'Places',      icon: <MapPin size={12} /> },
  events:     { label: 'Events',      icon: <Zap size={12} /> },
}

function SidebarSection({ section, items, selectedSlug, onSelect }: {
  section: Section
  items: WikiPageSummary[]
  selectedSlug: string | null
  onSelect: (slug: string, bookId?: number) => void
}) {
  const [open, setOpen] = useState(true)
  const { label, icon } = SECTION_CONFIG[section]

  if (items.length === 0) return null

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted hover:text-ink transition-colors"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {icon}
        {label}
        <span className="ml-auto font-normal opacity-60">{items.length}</span>
      </button>
      {open && (
        <ul className="px-1.5 pb-1">
          {items.map(item => (
            <li key={item.slug}>
              <button
                onClick={() => onSelect(item.slug, item.book_id)}
                className={`sidebar-item ${selectedSlug === item.slug ? 'sidebar-item-active' : 'text-ink-muted'}`}
                title={item.title}
              >
                {item.title}
                {item.book_title && (
                  <span className="text-[10px] text-ink-muted/60 ml-1">({item.book_title})</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function WikiSidebar({ pages, selectedSlug, onSelect, onHome }: Props) {
  const sections: Section[] = ['summaries', 'characters', 'places', 'events']
  const total = sections.reduce((n, s) => n + pages[s].length, 0)

  return (
    <nav>
      {/* Home / overview button */}
      <div className="px-1.5 pb-1 mb-1 border-b border-parchment-200">
        <button
          onClick={onHome}
          className={`sidebar-item flex items-center gap-1.5 ${selectedSlug === null ? 'sidebar-item-active' : 'text-ink-muted'}`}
        >
          <LayoutDashboard size={11} />
          Overview
        </button>
      </div>

      {total === 0 ? (
        <p className="px-4 py-3 text-xs text-ink-muted italic">No pages yet.</p>
      ) : (
        sections.map(section => (
          <SidebarSection
            key={section}
            section={section}
            items={pages[section]}
            selectedSlug={selectedSlug}
            onSelect={onSelect}
          />
        ))
      )}
    </nav>
  )
}
