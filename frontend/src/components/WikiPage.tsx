import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link2 } from 'lucide-react'
import type { WikiPageContent } from '../lib/api'

interface Props {
  page: WikiPageContent
  onNavigate: (slug: string) => void
  visibleSlugs?: Set<string>
}

const TYPE_LABEL: Record<string, string> = {
  summary:   'Chapter',
  character: 'Character',
  place:     'Place',
  event:     'Event',
}

const TYPE_COLOR: Record<string, string> = {
  summary:   'text-blue-700   bg-blue-50   border-blue-200',
  character: 'text-purple-700 bg-purple-50 border-purple-200',
  place:     'text-emerald-700 bg-emerald-50 border-emerald-200',
  event:     'text-orange-700 bg-orange-50 border-orange-200',
}

export default function WikiPage({ page, onNavigate, visibleSlugs }: Props) {
  const processedMarkdown = page.content_markdown.replace(
    /\[\[(\w+):([^\]]+)\]\]/g,
    (_, type, name) => {
      const slug = slugify(`${type}-${name}`)
      const exists = visibleSlugs
        ? visibleSlugs.has(slug)
        : (page.outgoing_links.find(l => l.slug === slug)?.exists ?? false)
      return exists
        ? `[${name}](wiki:${slug})`
        : `[${name}](wiki-missing:${slug})`
    }
  )

  const colorClass = TYPE_COLOR[page.page_type] ?? 'text-ink-muted bg-parchment-100 border-parchment-300'

  return (
    <article className="max-w-2xl">
      {/* Header */}
      <div className="mb-7">
        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-flex text-[11px] px-2 py-0.5 rounded-full border font-medium ${colorClass}`}>
            {TYPE_LABEL[page.page_type] ?? page.page_type}
          </span>
          <span className="text-xs text-ink-muted">
            Ch. {page.first_visible_chapter}
            {page.last_updated_chapter > page.first_visible_chapter && (
              <> – {page.last_updated_chapter}</>
            )}
          </span>
        </div>
        <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'Georgia, serif' }}>
          {page.title}
        </h1>
      </div>

      {/* Content */}
      <div className="wiki-content prose prose-stone max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          urlTransform={(url) => url}
          components={{
            a({ href, children }) {
              if (href?.startsWith('wiki:')) {
                return (
                  <button onClick={() => onNavigate(href.slice(5))} className="wiki-link">
                    {children}
                  </button>
                )
              }
              if (href?.startsWith('wiki-missing:')) {
                return <span className="wiki-link-missing" title="Not yet revealed">{children}</span>
              }
              return <a href={href} className="wiki-link">{children}</a>
            },
          }}
        >
          {processedMarkdown}
        </ReactMarkdown>
      </div>

      {/* Backlinks */}
      {page.backlinks.length > 0 && (
        <div className="mt-8 pt-5 border-t border-parchment-200">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
            <Link2 size={11} /> Referenced by
          </p>
          <div className="flex flex-wrap gap-1.5">
            {page.backlinks.map(bl => (
              <button
                key={bl.slug}
                onClick={() => onNavigate(bl.slug)}
                className="text-xs px-2.5 py-1 rounded-lg border border-parchment-300 hover:border-parchment-400 hover:bg-parchment-100 text-ink-muted hover:text-ink transition-colors"
              >
                {bl.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '')
}
