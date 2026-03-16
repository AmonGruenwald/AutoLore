import { useState } from 'react'
import { ChevronDown, ChevronRight, User, MapPin, Zap, BookOpenCheck } from 'lucide-react'
import type { WikiPageList, WikiPageSummary } from '../lib/api'

interface Props {
  pages: WikiPageList
  selectedSlug: string | null
  onSelect: (slug: string, bookId?: number) => void
}

type Section = 'summaries' | 'characters' | 'places' | 'events'

const SECTION_CONFIG: Record<Section, { label: string; icon: React.ReactNode }> = {
  summaries: { label: 'Chapters', icon: <BookOpenCheck size={14} /> },
  characters: { label: 'Characters', icon: <User size={14} /> },
  places: { label: 'Places', icon: <MapPin size={14} /> },
  events: { label: 'Events', icon: <Zap size={14} /> },
}

function SidebarSection({
  section,
  items,
  selectedSlug,
  onSelect,
}: {
  section: Section
  items: WikiPageSummary[]
  selectedSlug: string | null
  onSelect: (slug: string, bookId?: number) => void
}) {
  const [open, setOpen] = useState(true)
  const { label, icon } = SECTION_CONFIG[section]

  if (items.length === 0) return null

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-ink-muted hover:text-ink transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        {label} ({items.length})
      </button>
      {open && (
        <ul>
          {items.map(item => (
            <li key={item.slug}>
              <button
                onClick={() => onSelect(item.slug, item.book_id)}
                className={`sidebar-item w-full text-left truncate ${
                  selectedSlug === item.slug ? 'sidebar-item-active' : ''
                }`}
                title={item.title}
              >
                {item.title}
                {item.book_title && (
                  <span className="text-xs text-ink-muted ml-1">({item.book_title})</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function WikiSidebar({ pages, selectedSlug, onSelect }: Props) {
  const sections: Section[] = ['summaries', 'characters', 'places', 'events']
  const total = sections.reduce((n, s) => n + pages[s].length, 0)

  if (total === 0) {
    return (
      <div className="p-4 text-sm text-ink-muted italic">
        No wiki pages available yet.
      </div>
    )
  }

  return (
    <nav className="overflow-y-auto">
      {sections.map(section => (
        <SidebarSection
          key={section}
          section={section}
          items={pages[section]}
          selectedSlug={selectedSlug}
          onSelect={onSelect}
        />
      ))}
    </nav>
  )
}
