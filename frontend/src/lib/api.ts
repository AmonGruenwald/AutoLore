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

export const getWikiPage = (bookId: number, slug: string, upToChapter: number) =>
  request<WikiPageContent>(`/wiki/${bookId}/page/${slug}?up_to_chapter=${upToChapter}`)

export const getSeriesWikiPages = (seriesId: number, upToChapter: number) =>
  request<WikiPageList>(`/wiki/series/${seriesId}/pages?up_to_global_chapter=${upToChapter}`)

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
export interface Book {
  id: number
  title: string
  author: string
  total_chapters: number
  generation_status: 'pending' | 'processing' | 'waiting' | 'done' | 'error'
  generation_progress: number
  generation_step: string | null
  series_id: number | null
  series_order: number | null
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
  content_markdown: string
  first_visible_chapter: number
  last_updated_chapter: number
  outgoing_links: WikiLink[]
  backlinks: { slug: string; title: string; page_type: string }[]
  version_history: { chapter: number }[]
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
