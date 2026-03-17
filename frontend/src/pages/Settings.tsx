import { useState, useEffect } from 'react'
import { Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import { getSettings, updateSettings } from '../lib/api'
import type { AppSettings } from '../lib/api'

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getSettings().then(s => {
      setSettings(s)
      const isKnown = s.available_models.some(m => m.id === s.openrouter_model)
      if (isKnown) {
        setModel(s.openrouter_model)
      } else {
        setUseCustom(true)
        setCustomModel(s.openrouter_model)
      }
    })
  }, [])

  async function save() {
    setSaving(true)
    setError('')
    try {
      const activeModel = useCustom ? customModel.trim() : model
      if (!activeModel) { setError('Model is required'); setSaving(false); return }
      const update: Record<string, string> = { openrouter_model: activeModel }
      if (apiKey.trim()) update.openrouter_api_key = apiKey.trim()
      await updateSettings(update)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      const s = await getSettings()
      setSettings(s)
      setApiKey('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!settings) return null

  return (
    <div className="max-w-md mx-auto px-6 py-10">
      <h1 className="text-lg font-semibold mb-8">Settings</h1>

      <div className="space-y-6">

        {/* API Key */}
        <div>
          <label className="block text-sm font-medium mb-1.5">OpenRouter API key</label>
          {settings.openrouter_api_key_set && (
            <p className="flex items-center gap-1 text-xs text-emerald-600 mb-1.5">
              <CheckCircle2 size={11} /> Configured ({settings.openrouter_api_key_hint})
            </p>
          )}
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={settings.openrouter_api_key_set ? 'Enter new key to update' : 'sk-or-…'}
              className="w-full border border-parchment-300 rounded-lg px-3 py-2 pr-9 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink-muted transition-colors"
            />
            <button
              onClick={() => setShowKey(v => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink transition-colors"
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-xs text-ink-muted mt-1.5">
            Get your key at{' '}
            <code className="bg-parchment-200 px-1 py-0.5 rounded text-[11px]">openrouter.ai/keys</code>
          </p>
        </div>

        {/* Model */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium">Model</label>
            <button
              type="button"
              onClick={() => setUseCustom(v => !v)}
              className="text-xs text-ink-muted hover:text-ink underline transition-colors"
            >
              {useCustom ? 'Pick from list' : 'Custom model ID'}
            </button>
          </div>
          {useCustom ? (
            <input
              type="text"
              value={customModel}
              onChange={e => setCustomModel(e.target.value)}
              placeholder="e.g. meta-llama/llama-3.1-70b-instruct"
              className="w-full border border-parchment-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink-muted transition-colors font-mono"
            />
          ) : (
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="w-full border border-parchment-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink-muted transition-colors"
            >
              {settings.available_models.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
          <p className="text-xs text-ink-muted mt-1.5">
            Any model on OpenRouter works. Higher quality models give better wikis.
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg bg-ink text-parchment-100 hover:bg-ink-light disabled:opacity-50 transition-colors"
        >
          {saved && <CheckCircle2 size={14} />}
          {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Info box */}
      <div className="mt-10 border border-parchment-300 rounded-xl p-4 text-xs text-ink-muted space-y-1">
        <p className="font-medium text-ink text-sm mb-2">About wiki generation</p>
        <p>· Wiki is generated when you import a book.</p>
        <p>· Only the book's own text is used — no external knowledge.</p>
        <p>· You can regenerate the wiki from the library at any time.</p>
        <p>· The chapter slider controls spoiler visibility.</p>
      </div>
    </div>
  )
}
