const BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || `HTTP ${resp.status}`)
  }
  return resp.json()
}

// Books
export const getBooks = () => request<Book[]>('/books/')
export const getBook = (id: number) => request<BookDetail>(`/books/${id}`)
export const deleteBook = (id: number) =>
  request(`/books/${id}`, { method: 'DELETE' })
export const regenerateWiki = (id: number) =>
  request(`/books/${id}/regenerate`, { method: 'POST' })

export const continueProcessing = (id: number) =>
  request(`/books/${id}/continue`, { method: 'POST' })

export const getChapters = (id: number) =>
  request<ChapterList>(`/books/${id}/chapters`)

export const confirmChapterSelection = (
  id: number,
  selections: { id: number; include: boolean }[],
  merges: number[][],
  renames: { id: number; title: string }[] = [],
) =>
  request(`/books/${id}/confirm-selection`, {
    method: 'POST',
    body: JSON.stringify({ selections, merges, renames }),
  })

export const setStopChapter = (id: number, stopChapter: number | null) =>
  request(`/books/${id}/stop-chapter`, { method: 'PATCH', body: JSON.stringify({ stop_chapter: stopChapter }) })

export async function uploadBook(file: File): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  const resp = await fetch(`${BASE}/books/upload`, { method: 'POST', body: form })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || `HTTP ${resp.status}`)
  }
  return resp.json()
}

export async function confirmDuplicateUpload(file: File): Promise<UploadResult> {
  const bytes = await file.arrayBuffer()
  const hex = Array.from(new Uint8Array(bytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return request('/books/upload/confirm-duplicate', {
    method: 'POST',
    body: JSON.stringify({ file_bytes_hex: hex, filename: file.name }),
  })
}

// Wiki
export const getWikiPages = (bookId: number, upToChapter: number) =>
  request<WikiPageList>(`/wiki/${bookId}/pages?up_to_chapter=${upToChapter}`)

export const getWikiGraph = (bookId: number, upToChapter: number) =>
  request<WikiGraph>(`/wiki/${bookId}/graph?up_to_chapter=${upToChapter}`)

export const getStoryBlurb = (bookId: number, upToChapter: number, force = false) =>
  request<{ blurb: string }>(`/wiki/${bookId}/blurb?up_to_chapter=${upToChapter}${force ? '&force=true' : ''}`)

export const getWikiPage = (bookId: number, slug: string, upToChapter: number) =>
  request<WikiPageContent>(`/wiki/${bookId}/page/${slug}?up_to_chapter=${upToChapter}`)

export const deleteWikiPage = (bookId: number, slug: string) =>
  request(`/wiki/${bookId}/page/${slug}`, { method: 'DELETE' })

export const mergeWikiPages = (bookId: number, slug: string, mergeWithSlug: string) =>
  request<WikiPageContent>(`/wiki/${bookId}/page/${slug}/merge`, {
    method: 'POST',
    body: JSON.stringify({ merge_with_slug: mergeWithSlug }),
  })

export const updateWikiPage = (bookId: number, slug: string, title: string, content: string, editChapter: number, aliases?: string[]) =>
  request<WikiPageContent>(`/wiki/${bookId}/page/${slug}`, {
    method: 'PUT',
    body: JSON.stringify({ title, content, edit_chapter: editChapter, aliases }),
  })

export const retypeWikiPage = (bookId: number, slug: string, pageType: string) =>
  request<{ id: number; slug: string; title: string; page_type: string }>(`/wiki/${bookId}/page/${slug}/retype`, {
    method: 'POST',
    body: JSON.stringify({ page_type: pageType }),
  })

export async function regenerateWikiPage(
  bookId: number,
  slug: string,
  upToChapter: number,
  onUpdate: (content: string, progress: number, total: number) => void,
): Promise<string> {
  const resp = await fetch(`${BASE}/wiki/${bookId}/page/${slug}/regenerate?up_to_chapter=${upToChapter}`, {
    method: 'POST',
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || `HTTP ${resp.status}`)
  }

  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalContent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = JSON.parse(line.slice(6))
      if (data.type === 'update') {
        finalContent = data.content
        onUpdate(data.content, data.progress, data.total)
      } else if (data.type === 'done') {
        finalContent = data.content
      } else if (data.type === 'error') {
        throw new Error(data.message)
      }
    }
  }
  return finalContent
}

export const getSeriesWikiPages = (seriesId: number, upToChapter: number) =>
  request<WikiPageList>(`/wiki/series/${seriesId}/pages?up_to_global_chapter=${upToChapter}`)

export interface AskResponse {
  answer: string
  sources: { title: string; slug: string; page_type: string }[]
}

export const askQuestion = (
  bookId: number,
  question: string,
  upToChapter: number,
  conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [],
) =>
  request<AskResponse>(`/wiki/${bookId}/ask`, {
    method: 'POST',
    body: JSON.stringify({
      question,
      up_to_chapter: upToChapter,
      conversation_history: conversationHistory,
    }),
  })

// Series
export const getSeries = () => request<Series[]>('/books/series/all')
export const createSeries = (name: string, bookIds: number[]) =>
  request('/books/series', { method: 'POST', body: JSON.stringify({ name, book_ids: bookIds }) })
export const updateSeries = (id: number, name: string, bookIds: number[]) =>
  request(`/books/series/${id}`, { method: 'PUT', body: JSON.stringify({ name, book_ids: bookIds }) })
export const deleteSeries = (id: number) =>
  request(`/books/series/${id}`, { method: 'DELETE' })

// Settings
export const getSettings = () => request<AppSettings>('/settings/')
export const updateSettings = (data: Partial<{ openrouter_api_key: string; openrouter_model: string }>) =>
  request('/settings/', { method: 'PUT', body: JSON.stringify(data) })

// Types
export interface ChapterPreview {
  id: number
  number: number
  title: string
  one_sentence_summary: string | null
}

export interface ChapterList {
  book_id: number
  title: string
  generation_step: string | null
  chapters: ChapterPreview[]
}

export interface Book {
  id: number
  title: string
  author: string
  total_chapters: number
  generation_status: 'selecting' | 'pending' | 'processing' | 'waiting' | 'done' | 'error'
  generation_progress: number
  generation_step: string | null
  series_id: number | null
  series_order: number | null
  stop_chapter: number | null
  created_at: string
}

export interface BookDetail extends Book {
  generation_error: string | null
  chapters: { number: number; title: string }[]
}

export interface UploadResult {
  status: 'imported' | 'duplicate_found'
  book_id?: number
  title?: string
  existing_book_id?: number
  existing_title?: string
  confidence?: number
  reasoning?: string
  parsed_title?: string
  parsed_author?: string
}

export interface WikiPageSummary {
  id: number
  slug: string
  title: string
  page_type: string
  first_visible_chapter: number
  last_updated_chapter: number
  aliases?: string[]
  book_id?: number
  book_title?: string
}

export interface WikiPageList {
  summaries: WikiPageSummary[]
  characters: WikiPageSummary[]
  places: WikiPageSummary[]
  events: WikiPageSummary[]
}

export interface WikiLink {
  text: string
  slug: string
  page_type: string
  exists: boolean
}

export interface WikiPageContent {
  id: number
  slug: string
  title: string
  page_type: string
  aliases: string[]
  content_markdown: string
  first_visible_chapter: number
  last_updated_chapter: number
  outgoing_links: WikiLink[]
  backlinks: { slug: string; title: string; page_type: string }[]
  version_history: { chapter: number }[]
}

export interface GraphNode {
  id: string
  slug: string
  title: string
  page_type: string
  first_visible_chapter: number
}

export interface GraphEdge {
  source: string
  target: string
}

export interface WikiGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface Series {
  id: number
  name: string
  book_order: number[]
}

export interface AppSettings {
  openrouter_api_key_set: boolean
  openrouter_api_key_hint: string
  openrouter_model: string
  available_models: { id: string; name: string }[]
}
