import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, Link2, ExternalLink } from 'lucide-react'
import type { WikiPageContent } from '../lib/api'

interface Props {
  page: WikiPageContent
  onNavigate: (slug: string) => void
  visibleSlugs?: Set<string>
}

const TYPE_BADGE: Record<string, string> = {
  summary: 'bg-blue-100 text-blue-800',
  character: 'bg-purple-100 text-purple-800',
  place: 'bg-green-100 text-green-800',
  event: 'bg-orange-100 text-orange-800',
}

export default function WikiPage({ page, onNavigate, visibleSlugs }: Props) {
  // Replace [[Type:Name]] links in markdown with a marker we can intercept.
  // Existence check: prefer the authoritative visibleSlugs set (derived from
  // the current page list), fall back to the stored outgoing_links exists flag.
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

  return (
    <article className="max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_BADGE[page.page_type] ?? 'bg-gray-100 text-gray-700'}`}>
            {page.page_type}
          </span>
          <span className="text-xs text-ink-muted">
            First appeared: Chapter {page.first_visible_chapter}
            {page.last_updated_chapter > page.first_visible_chapter && (
              <> · Last updated: Chapter {page.last_updated_chapter}</>
            )}
          </span>
        </div>
        <h1 className="text-3xl font-bold text-ink">{page.title}</h1>
      </div>

      {/* Content */}
      <div className="wiki-content prose prose-stone max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a({ href, children }) {
              if (href?.startsWith('wiki:')) {
                const slug = href.slice(5)
                return (
                  <button
                    onClick={() => onNavigate(slug)}
                    className="wiki-link"
                  >
                    {children}
                  </button>
                )
              }
              if (href?.startsWith('wiki-missing:')) {
                return (
                  <span className="wiki-link-missing" title="Not yet revealed">
                    {children}
                  </span>
                )
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
        <div className="mt-8 pt-4 border-t border-parchment-300">
          <h3 className="text-sm font-bold text-ink-muted uppercase tracking-wider mb-2 flex items-center gap-1">
            <Link2 size={13} /> Referenced by
          </h3>
          <div className="flex flex-wrap gap-2">
            {page.backlinks.map(bl => (
              <button
                key={bl.slug}
                onClick={() => onNavigate(bl.slug)}
                className="text-sm wiki-link flex items-center gap-1"
              >
                <ExternalLink size={11} />
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
