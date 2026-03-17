import { useState, useRef, useEffect } from 'react'
import { X, Send, Loader2, MessageCircle, AlertCircle } from 'lucide-react'
import { askQuestion } from '../lib/api'
import type { AskResponse } from '../lib/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: AskResponse['sources']
  error?: boolean
}

interface Props {
  bookId: number
  effectiveChapter: number
  onClose: () => void
  onNavigate: (slug: string) => void
}

const PAGE_TYPE_COLOR: Record<string, string> = {
  character: 'bg-purple-100 text-purple-700 hover:bg-purple-200',
  place:     'bg-emerald-100 text-emerald-700 hover:bg-emerald-200',
  event:     'bg-orange-100 text-orange-700 hover:bg-orange-200',
  summary:   'bg-blue-100 text-blue-700 hover:bg-blue-200',
}

export default function AskPanel({ bookId, effectiveChapter, onClose, onNavigate }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [contextChapter, setContextChapter] = useState(effectiveChapter)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // When the chapter changes mid-conversation, flag it but don't auto-clear
  const chapterMismatch = messages.length > 0 && effectiveChapter !== contextChapter

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function clearConversation() {
    setMessages([])
    setContextChapter(effectiveChapter)
  }

  async function handleSend() {
    const q = input.trim()
    if (!q || loading) return

    // If chapter changed, start fresh with the new chapter
    const chapter = effectiveChapter
    const history = effectiveChapter === contextChapter
      ? messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      : []

    if (effectiveChapter !== contextChapter) {
      setContextChapter(effectiveChapter)
      setMessages([])
    }

    const userMsg: Message = { role: 'user', content: q }
    setMessages(prev => (history.length === 0 ? [userMsg] : [...prev, userMsg]))
    setInput('')
    setLoading(true)

    try {
      const res = await askQuestion(bookId, q, chapter, history)
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: res.answer, sources: res.sources },
      ])
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Something went wrong. Please try again.', error: true },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full border-l border-parchment-200 bg-parchment-50 w-80 shrink-0">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-parchment-200 shrink-0">
        <div className="flex items-center gap-2">
          <MessageCircle size={13} className="text-amber-600" />
          <span className="text-sm font-semibold text-ink">Ask the Wiki</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-ink-muted/70 bg-parchment-200 px-1.5 py-0.5 rounded tabular-nums">
            ch. {effectiveChapter}
          </span>
          {messages.length > 0 && (
            <button
              onClick={clearConversation}
              className="text-[10px] text-ink-muted hover:text-ink underline"
              title="Clear conversation"
            >
              clear
            </button>
          )}
          <button onClick={onClose} className="text-ink-muted hover:text-ink transition-colors p-0.5 ml-1">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Chapter mismatch warning */}
      {chapterMismatch && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-700 flex items-center gap-1.5 shrink-0">
          <AlertCircle size={11} className="shrink-0" />
          Chapter changed to {effectiveChapter}. Next question will use the new context.
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center pt-12 space-y-2 text-ink-muted/50 select-none">
            <MessageCircle size={28} className="mx-auto opacity-30" />
            <p className="text-xs font-medium text-ink-muted/70">Ask anything about the book</p>
            <p className="text-[11px] leading-relaxed max-w-[200px] mx-auto">
              Answers only use what&apos;s been revealed up to chapter {effectiveChapter}.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={[
              'max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed',
              msg.role === 'user'
                ? 'bg-amber-600 text-white rounded-br-sm'
                : msg.error
                  ? 'bg-red-50 border border-red-200 text-red-700 rounded-bl-sm'
                  : 'bg-white border border-parchment-200 text-ink rounded-bl-sm',
            ].join(' ')}>
              {msg.content}
            </div>

            {/* Source chips */}
            {msg.sources && msg.sources.length > 0 && (
              <div className="flex flex-wrap gap-1 max-w-[92%] pl-1">
                {msg.sources.map(s => (
                  <button
                    key={s.slug}
                    onClick={() => onNavigate(s.slug)}
                    className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                      PAGE_TYPE_COLOR[s.page_type] ?? 'bg-parchment-200 text-ink-muted hover:bg-parchment-300'
                    }`}
                  >
                    {s.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Loading bubble */}
        {loading && (
          <div className="flex items-start">
            <div className="bg-white border border-parchment-200 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-ink-muted/40 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-ink-muted/40 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-ink-muted/40 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-parchment-200 shrink-0">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="Ask a question…"
            disabled={loading}
            className="flex-1 text-xs px-3 py-2 border border-parchment-300 rounded-xl bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="p-2 rounded-xl bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 transition-colors shrink-0"
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
