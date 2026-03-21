import { useState, useCallback } from 'react'
import { Check, GitMerge, Loader2, Pencil, Plus, X } from 'lucide-react'
import { confirmEntities } from '../lib/api'
import type { PendingEntity } from '../lib/api'

interface EntityRow {
  type: string
  name: string
  slug: string
  score: number
  significance: string
  selected: boolean
  aliases: string[]
  mergeIntoSlug: string | null  // slug of the entity this merges into
}

interface Props {
  bookId: number
  entities: PendingEntity[]
  chapterNumber: number
  onConfirmed: () => void
}

const TYPE_COLORS: Record<string, string> = {
  character: 'bg-blue-100 text-blue-700 border-blue-200',
  place: 'bg-green-100 text-green-700 border-green-200',
  event: 'bg-purple-100 text-purple-700 border-purple-200',
}

const SCORE_COLORS = (score: number) => {
  if (score >= 70) return 'bg-emerald-100 text-emerald-700 border-emerald-200'
  if (score >= 50) return 'bg-amber-100 text-amber-700 border-amber-200'
  return 'bg-red-100 text-red-700 border-red-200'
}

const AUTO_SELECT_THRESHOLD = 70

export default function EntitySelectionPanel({ bookId, entities, chapterNumber, onConfirmed }: Props) {
  const [rows, setRows] = useState<EntityRow[]>(() =>
    [...entities]
      .sort((a, b) => b.score - a.score)
      .map(e => ({
        type: e.type,
        name: e.name,
        slug: e.slug,
        score: e.score,
        significance: e.significance,
        selected: e.score >= AUTO_SELECT_THRESHOLD,
        aliases: [],
        mergeIntoSlug: null,
      }))
  )

  const [editingName, setEditingName] = useState<string | null>(null)  // slug being renamed
  const [editingAlias, setEditingAlias] = useState<string | null>(null) // slug getting alias input
  const [mergingSlug, setMergingSlug] = useState<string | null>(null)   // slug being merged
  const [newNameValue, setNewNameValue] = useState('')
  const [newAliasValue, setNewAliasValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const updateRow = useCallback((slug: string, patch: Partial<EntityRow>) => {
    setRows(prev => prev.map(r => r.slug === slug ? { ...r, ...patch } : r))
  }, [])

  function toggleSelect(slug: string) {
    setRows(prev => prev.map(r => r.slug === slug ? { ...r, selected: !r.selected } : r))
  }

  function startRename(row: EntityRow) {
    setEditingName(row.slug)
    setNewNameValue(row.name)
    setEditingAlias(null)
    setMergingSlug(null)
  }

  function commitRename(slug: string) {
    const trimmed = newNameValue.trim()
    if (trimmed) updateRow(slug, { name: trimmed })
    setEditingName(null)
  }

  function startAlias(row: EntityRow) {
    setEditingAlias(row.slug)
    setNewAliasValue('')
    setEditingName(null)
    setMergingSlug(null)
  }

  function commitAlias(slug: string) {
    const trimmed = newAliasValue.trim()
    if (trimmed) {
      setRows(prev => prev.map(r =>
        r.slug === slug
          ? { ...r, aliases: [...r.aliases, trimmed] }
          : r
      ))
    }
    setEditingAlias(null)
  }

  function removeAlias(slug: string, alias: string) {
    setRows(prev => prev.map(r =>
      r.slug === slug ? { ...r, aliases: r.aliases.filter(a => a !== alias) } : r
    ))
  }

  function startMerge(row: EntityRow) {
    setMergingSlug(row.slug)
    setEditingName(null)
    setEditingAlias(null)
  }

  function applyMerge(sourceSlug: string, targetSlug: string) {
    // Mark source as merged into target, deselect it from independent generation
    updateRow(sourceSlug, { mergeIntoSlug: targetSlug, selected: true })
    setMergingSlug(null)
  }

  function clearMerge(slug: string) {
    updateRow(slug, { mergeIntoSlug: null })
  }

  async function handleConfirm() {
    setSubmitting(true)
    setError('')
    try {
      const payload = rows
        .filter(r => r.selected)
        .map(r => ({
          type: r.type,
          name: r.name,
          slug: r.slug,
          aliases: r.aliases,
          merge_into_slug: r.mergeIntoSlug,
        }))
      await confirmEntities(bookId, payload)
      onConfirmed()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Confirm failed')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedCount = rows.filter(r => r.selected && !r.mergeIntoSlug).length
  const mergedCount = rows.filter(r => r.selected && r.mergeIntoSlug).length

  // Rows available as merge targets (same type, not the source itself)
  const mergeTargetsFor = (slug: string, type: string) =>
    rows.filter(r => r.slug !== slug && r.type === type && !r.mergeIntoSlug)

  return (
    <div className="border-b border-parchment-200 bg-parchment-50 shrink-0">
      <div className="px-4 md:px-6 py-3">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div>
            <p className="text-sm font-medium text-ink">
              Select entities to update for chapter {chapterNumber}
            </p>
            <p className="text-xs text-ink-muted mt-0.5">
              Entities with score ≥ {AUTO_SELECT_THRESHOLD} are auto-selected.
              {selectedCount > 0 && <span className="ml-1">{selectedCount} selected{mergedCount > 0 ? `, ${mergedCount} merged` : ''}.</span>}
            </p>
          </div>
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-ink text-parchment-100 hover:bg-ink-light disabled:opacity-50 transition-colors shrink-0"
          >
            {submitting ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            Confirm
          </button>
        </div>

        {error && (
          <p className="text-xs text-red-600 mb-2">{error}</p>
        )}

        <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
          {rows.map(row => {
            const isMerged = !!row.mergeIntoSlug
            const mergeTarget = isMerged ? rows.find(r => r.slug === row.mergeIntoSlug) : null
            const isMergingThis = mergingSlug === row.slug

            return (
              <div
                key={row.slug}
                className={`flex flex-wrap items-center gap-2 px-2 py-1.5 rounded-lg border text-xs transition-colors ${
                  row.selected
                    ? isMerged
                      ? 'bg-amber-50 border-amber-200'
                      : 'bg-white border-parchment-300'
                    : 'bg-parchment-50/50 border-transparent opacity-60'
                }`}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={row.selected}
                  onChange={() => toggleSelect(row.slug)}
                  className="accent-ink shrink-0"
                />

                {/* Score badge */}
                <span className={`px-1.5 py-0.5 rounded border font-mono font-medium shrink-0 ${SCORE_COLORS(row.score)}`}>
                  {row.score}
                </span>

                {/* Type badge */}
                <span className={`px-1.5 py-0.5 rounded border capitalize shrink-0 ${TYPE_COLORS[row.type] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                  {row.type}
                </span>

                {/* Name (editable) */}
                {editingName === row.slug ? (
                  <input
                    autoFocus
                    value={newNameValue}
                    onChange={e => setNewNameValue(e.target.value)}
                    onBlur={() => commitRename(row.slug)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(row.slug); if (e.key === 'Escape') setEditingName(null) }}
                    className="flex-1 min-w-24 px-1.5 py-0.5 border border-amber-400 rounded focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white text-ink"
                  />
                ) : (
                  <button
                    onClick={() => startRename(row)}
                    title="Click to rename"
                    className="flex items-center gap-1 font-medium text-ink hover:text-amber-700 group"
                  >
                    {row.name}
                    <Pencil size={10} className="opacity-0 group-hover:opacity-50 transition-opacity" />
                  </button>
                )}

                {/* Merge indicator */}
                {isMerged && mergeTarget && (
                  <span className="flex items-center gap-1 text-amber-700">
                    <GitMerge size={10} />
                    into {mergeTarget.name}
                    <button onClick={() => clearMerge(row.slug)} className="hover:text-red-500 ml-0.5">
                      <X size={10} />
                    </button>
                  </span>
                )}

                {/* Aliases */}
                {row.aliases.map(alias => (
                  <span key={alias} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-parchment-100 border border-parchment-200 rounded text-ink-muted">
                    {alias}
                    <button onClick={() => removeAlias(row.slug, alias)} className="hover:text-red-500 ml-0.5">
                      <X size={9} />
                    </button>
                  </span>
                ))}

                {/* Alias input */}
                {editingAlias === row.slug ? (
                  <input
                    autoFocus
                    placeholder="alias…"
                    value={newAliasValue}
                    onChange={e => setNewAliasValue(e.target.value)}
                    onBlur={() => commitAlias(row.slug)}
                    onKeyDown={e => { if (e.key === 'Enter') commitAlias(row.slug); if (e.key === 'Escape') setEditingAlias(null) }}
                    className="w-24 px-1.5 py-0.5 border border-parchment-300 rounded focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white text-ink"
                  />
                ) : (
                  <button
                    onClick={() => startAlias(row)}
                    title="Add alias"
                    className="text-ink-muted hover:text-ink transition-colors"
                  >
                    <Plus size={11} />
                  </button>
                )}

                {/* Merge picker */}
                {!isMerged && (
                  isMergingThis ? (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-ink-muted">merge into:</span>
                      {mergeTargetsFor(row.slug, row.type).map(t => (
                        <button
                          key={t.slug}
                          onClick={() => applyMerge(row.slug, t.slug)}
                          className="px-1.5 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-800 hover:bg-amber-200 transition-colors"
                        >
                          {t.name}
                        </button>
                      ))}
                      <button onClick={() => setMergingSlug(null)} className="text-ink-muted hover:text-ink">
                        <X size={11} />
                      </button>
                    </div>
                  ) : (
                    mergeTargetsFor(row.slug, row.type).length > 0 && (
                      <button
                        onClick={() => startMerge(row)}
                        title="Merge with another entity"
                        className="text-ink-muted hover:text-ink transition-colors ml-auto"
                      >
                        <GitMerge size={11} />
                      </button>
                    )
                  )
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
