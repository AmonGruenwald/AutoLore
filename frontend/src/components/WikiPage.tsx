import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link2, Trash2, GitMerge, X, Loader2, Pencil, Check, RefreshCw, ArrowRightLeft } from 'lucide-react'
import type { WikiPageContent, WikiPageSummary } from '../lib/api'
import { regenerateWikiPage } from '../lib/api'

interface Props {
  page: WikiPageContent
  bookId: number
  upToChapter: number
  onNavigate: (slug: string) => void
  visibleSlugs?: Set<string>
  aliasToCanonical?: Map<string, string>
  sameTypePages: WikiPageSummary[]   // other pages of same type for merge picker
  onDelete: () => void
  onMerge: (targetSlug: string) => void
  onEdit: (title: string, content: string) => Promise<void>
  onRetype: (newType: string) => Promise<void>
  onRegenerate: (content: string) => void
  merging: boolean
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

const ENTITY_TYPES = ['character', 'place', 'event'] as const

export default function WikiPage({ page, bookId, upToChapter, onNavigate, visibleSlugs, aliasToCanonical, sameTypePages, onDelete, onMerge, onEdit, onRetype, onRegenerate, merging }: Props) {
  const [showMergePicker, setShowMergePicker] = useState(false)
  const [showRetypePicker, setShowRetypePicker] = useState(false)
  const [retyping, setRetyping] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editTitle, setEditTitle] = useState(page.title)
  const [editContent, setEditContent] = useState(page.content_markdown)
  const [regenerating, setRegenerating] = useState(false)
  const [regenerateProgress, setRegenerateProgress] = useState<{ current: number; total: number } | null>(null)
  const [streamingContent, setStreamingContent] = useState<string | null>(null)
  const [regenerateError, setRegenerateError] = useState<string | null>(null)

  // Reset edit fields when page changes
  const pageKey = page.slug
  const [lastPageKey, setLastPageKey] = useState(pageKey)
  if (pageKey !== lastPageKey) {
    setLastPageKey(pageKey)
    setEditing(false)
    setSaving(false)
    setEditTitle(page.title)
    setEditContent(page.content_markdown)
    setRegenerating(false)
    setRegenerateProgress(null)
    setStreamingContent(null)
    setRegenerateError(null)
    setShowRetypePicker(false)
    setRetyping(false)
  }
  const processedMarkdown = page.content_markdown.replace(
    /\[\[([^\]]+)\]\]/g,
    (_, raw) => {
      const colonIdx = raw.indexOf(':')
      const name = colonIdx !== -1 ? raw.slice(colonIdx + 1).trim() : raw.trim()
      const slug = slugify(name)
      const canonicalSlug = aliasToCanonical?.get(slug) ?? slug
      const exists = visibleSlugs
        ? (visibleSlugs.has(slug) || visibleSlugs.has(canonicalSlug))
        : (page.outgoing_links.find(l => l.slug === slug)?.exists ?? false)
      return exists
        ? `[${name}](wiki:${canonicalSlug})`
        : name
    }
  )

  const colorClass = TYPE_COLOR[page.page_type] ?? 'text-ink-muted bg-parchment-100 border-parchment-300'
  const mergeCandidates = sameTypePages.filter(p => p.slug !== page.slug)
  const canRegenerate = page.page_type !== 'summary'

  async function handleSave() {
    setSaving(true)
    try {
      await onEdit(editTitle.trim() || page.title, editContent)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  function handleCancelEdit() {
    setEditing(false)
    setEditTitle(page.title)
    setEditContent(page.content_markdown)
  }

  async function handleRegenerate() {
    setRegenerating(true)
    setRegenerateError(null)
    setStreamingContent('')
    setRegenerateProgress(null)
    try {
      const finalContent = await regenerateWikiPage(
        bookId,
        page.slug,
        upToChapter,
        (content, progress, total) => {
          setStreamingContent(content)
          setRegenerateProgress({ current: progress, total })
        },
      )
      onRegenerate(finalContent)
    } catch (e) {
      setRegenerateError(e instanceof Error ? e.message : 'Regeneration failed')
      setStreamingContent(null)
    } finally {
      setRegenerating(false)
      setRegenerateProgress(null)
    }
  }

  async function handleRetype(newType: string) {
    setShowRetypePicker(false)
    setRetyping(true)
    try {
      await onRetype(newType)
    } finally {
      setRetyping(false)
    }
  }

  const busy = editing || regenerating || merging || retyping

  return (
    <article className="max-w-3xl mx-auto">
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

          {/* Regenerate progress */}
          {regenerating && regenerateProgress && (
            <span className="text-xs text-amber-600">
              Chapter {regenerateProgress.current}/{regenerateProgress.total}…
            </span>
          )}

          {/* Page actions */}
          {!editing && !regenerating && (
            <div className="ml-auto flex items-center gap-1 relative">
              {/* Regenerate */}
              {canRegenerate && (
                <button
                  onClick={handleRegenerate}
                  title="Regenerate from source chapters"
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-parchment-300 text-ink-muted hover:border-amber-300 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                >
                  <RefreshCw size={11} />
                  Regenerate
                </button>
              )}

              {/* Edit */}
              <button
                onClick={() => { setEditTitle(page.title); setEditContent(page.content_markdown); setEditing(true) }}
                title="Edit page"
                className="p-1.5 rounded-lg border border-parchment-200 text-ink-muted hover:bg-parchment-100 hover:border-parchment-300 hover:text-ink transition-colors"
              >
                <Pencil size={12} />
              </button>

              {/* Merge */}
              {mergeCandidates.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setShowMergePicker(v => !v)}
                    title="Merge with another page"
                    disabled={merging}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-parchment-300 text-ink-muted hover:border-parchment-400 hover:text-ink transition-colors disabled:opacity-40"
                  >
                    {merging
                      ? <Loader2 size={11} className="animate-spin" />
                      : <GitMerge size={11} />}
                    {merging ? 'Merging…' : 'Merge'}
                  </button>

                  {showMergePicker && !merging && (
                    <>
                      {/* Backdrop */}
                      <div className="fixed inset-0 z-10" onClick={() => setShowMergePicker(false)} />
                      <div className="absolute right-0 top-full mt-1 z-20 w-56 bg-white border border-parchment-300 rounded-xl shadow-lg py-1 overflow-hidden">
                        <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-ink-muted">
                          Merge into…
                        </p>
                        {mergeCandidates.map(p => (
                          <button
                            key={p.slug}
                            onClick={() => { setShowMergePicker(false); onMerge(p.slug) }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-parchment-100 transition-colors truncate"
                          >
                            {p.title}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Change type */}
              {page.page_type !== 'summary' && (
                <div className="relative">
                  <button
                    onClick={() => setShowRetypePicker(v => !v)}
                    title="Change entity type"
                    disabled={retyping}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-parchment-300 text-ink-muted hover:border-parchment-400 hover:text-ink transition-colors disabled:opacity-40"
                  >
                    {retyping
                      ? <Loader2 size={11} className="animate-spin" />
                      : <ArrowRightLeft size={11} />}
                    {retyping ? 'Moving…' : 'Move to'}
                  </button>

                  {showRetypePicker && !retyping && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowRetypePicker(false)} />
                      <div className="absolute right-0 top-full mt-1 z-20 w-40 bg-white border border-parchment-300 rounded-xl shadow-lg py-1 overflow-hidden">
                        <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-ink-muted">
                          Move to…
                        </p>
                        {ENTITY_TYPES.filter(t => t !== page.page_type).map(t => (
                          <button
                            key={t}
                            onClick={() => handleRetype(t)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-parchment-100 transition-colors capitalize"
                          >
                            {TYPE_LABEL[t]}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Delete */}
              {confirmDelete ? (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-red-600">Delete?</span>
                  <button
                    onClick={() => { setConfirmDelete(false); onDelete() }}
                    className="px-2 py-1 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="p-1 text-ink-muted hover:text-ink transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  title="Delete page"
                  className="p-1.5 rounded-lg border border-parchment-200 text-ink-muted hover:bg-red-50 hover:border-red-200 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          )}

          {/* Regenerating spinner */}
          {regenerating && !editing && (
            <div className="ml-auto flex items-center gap-1.5 text-xs text-amber-600">
              <Loader2 size={11} className="animate-spin" />
              Regenerating…
            </div>
          )}

          {/* Edit mode save/cancel */}
          {editing && (
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-ink text-parchment-100 hover:bg-ink-light disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={handleCancelEdit}
                disabled={saving}
                className="p-1.5 rounded-lg border border-parchment-200 text-ink-muted hover:text-ink transition-colors disabled:opacity-50"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>

        {editing ? (
          <input
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            className="w-full text-2xl font-bold text-ink bg-transparent border-0 border-b-2 border-parchment-300 focus:border-amber-400 focus:outline-none pb-1"
            style={{ fontFamily: 'Georgia, serif' }}
            placeholder="Page title"
          />
        ) : (
          <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'Georgia, serif' }}>
            {page.title}
          </h1>
        )}
      </div>

      {/* Regeneration error */}
      {regenerateError && (
        <div className="mb-4 px-3 py-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <span>{regenerateError}</span>
          <button onClick={() => setRegenerateError(null)} className="ml-2 text-red-400 hover:text-red-600">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Content */}
      {editing ? (
        <textarea
          value={editContent}
          onChange={e => setEditContent(e.target.value)}
          rows={20}
          className="w-full text-sm text-ink font-mono bg-parchment-50 border border-parchment-300 rounded-lg p-3 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-y"
          placeholder="Page content (Markdown supported, use [[Name]] for wiki links)"
        />
      ) : (
        <div className={`wiki-content prose prose-stone max-w-none${regenerating ? ' opacity-60' : ''}`}>
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
                return <a href={href} className="wiki-link">{children}</a>
              },
            }}
          >
            {processedMarkdown}
          </ReactMarkdown>
        </div>
      )}

      {/* Backlinks */}
      {!editing && !busy && page.backlinks.length > 0 && (
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
