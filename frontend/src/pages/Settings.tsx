import { useState, useEffect } from 'react'
import { Save, Eye, EyeOff, CheckCircle } from 'lucide-react'
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
      // Refresh to get updated hint
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
    <div className="max-w-lg mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="bg-parchment-50 border border-parchment-300 rounded-lg p-5 space-y-5">
        {/* API Key */}
        <div>
          <label className="block text-sm font-semibold mb-1">OpenRouter API Key</label>
          {settings.openrouter_api_key_set && (
            <p className="text-xs text-green-700 mb-1 flex items-center gap-1">
              <CheckCircle size={12} /> Key configured ({settings.openrouter_api_key_hint})
            </p>
          )}
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={settings.openrouter_api_key_set ? 'Enter new key to update' : 'sk-or-...'}
              className="w-full border border-parchment-300 rounded px-3 py-1.5 pr-9 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <button
              onClick={() => setShowKey(v => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-xs text-ink-muted mt-1">
            Get your key at{' '}
            <span className="font-mono bg-parchment-200 px-1 rounded">openrouter.ai/keys</span>
          </p>
        </div>

        {/* Model selection */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-semibold">Model</label>
            <button
              type="button"
              onClick={() => setUseCustom(v => !v)}
              className="text-xs text-amber-700 hover:text-amber-900 underline"
            >
              {useCustom ? 'Pick from list' : 'Enter custom model ID'}
            </button>
          </div>
          {useCustom ? (
            <input
              type="text"
              value={customModel}
              onChange={e => setCustomModel(e.target.value)}
              placeholder="e.g. meta-llama/llama-3.1-70b-instruct"
              className="w-full border border-parchment-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono"
            />
          ) : (
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="w-full border border-parchment-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              {settings.available_models.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
          <p className="text-xs text-ink-muted mt-1">
            Any model available on OpenRouter can be used. Higher quality models give better results.
          </p>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded bg-ink text-parchment-100 hover:bg-ink-light disabled:opacity-50"
        >
          {saved ? <CheckCircle size={14} /> : <Save size={14} />}
          {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
        <p className="font-semibold mb-1">About wiki generation</p>
        <ul className="list-disc ml-4 space-y-1 text-xs">
          <li>Wiki is generated once when you import a book.</li>
          <li>The AI only uses text from the book — no external knowledge is used.</li>
          <li>You can regenerate the wiki from the library if needed.</li>
          <li>Reading progress controls which pages are visible (spoiler protection).</li>
        </ul>
      </div>
    </div>
  )
}
