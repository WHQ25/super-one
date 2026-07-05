import { useCallback, useEffect, useState } from 'react'
import { Check, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import type { MediaProviderStatus } from '@superone/shared/agent-types'

function ProviderRow({ provider, onChanged }: { provider: MediaProviderStatus; onChanged: () => void }) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  const saveKey = async (key: string) => {
    setSaving(true)
    const res = await window.app.setMediaProviderKey(provider.id, key)
    setSaving(false)
    if (res.ok) {
      setValue('')
      toast.success(key ? `${provider.label} key saved` : `${provider.label} key cleared`)
      onChanged()
    } else {
      toast.error(res.error)
    }
  }

  const removeProvider = async () => {
    const res = await window.app.removeMediaCustomProvider(provider.id)
    if (res.ok) {
      toast.success(`${provider.label} removed`)
      onChanged()
    } else {
      toast.error(res.error)
    }
  }

  const statusText = provider.hasKey
    ? 'API key configured'
    : provider.hasEnvKey
      ? `Using ${provider.apiKeyEnv} from environment`
      : 'No API key configured'

  return (
    <div className="border-t border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{provider.label}</p>
            {provider.custom && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">custom</span>
            )}
            {provider.hasKey && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                <Check className="size-3" />
                configured
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {statusText}
            {provider.defaultModel ? ` · default ${provider.defaultModel}` : ''}
            {provider.baseURL ? ` · ${provider.baseURL}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {provider.hasKey && (
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => void saveKey('')}>
              Clear
            </Button>
          )}
          {provider.custom && (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void removeProvider()}>
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={provider.hasKey ? 'Enter a new key to replace' : `Paste ${provider.label} API key`}
          className="h-8 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) void saveKey(value.trim())
          }}
        />
        <Button size="sm" disabled={saving || !value.trim()} onClick={() => void saveKey(value.trim())}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Save'}
        </Button>
      </div>
      {provider.models.length > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {provider.models.length} model{provider.models.length > 1 ? 's' : ''}: {provider.models.map((m) => m.label).join(', ')}
        </p>
      )}
    </div>
  )
}

function AddCustomProvider({ onAdded }: { onAdded: () => void }) {
  const [label, setLabel] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [models, setModels] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  const canSave = label.trim() && baseURL.trim() && models.trim()

  const submit = async () => {
    setSaving(true)
    const modelList = models.split(',').map((m) => m.trim()).filter(Boolean)
    const res = await window.app.upsertMediaCustomProvider({ label: label.trim(), baseURL: baseURL.trim(), models: modelList })
    if (!res.ok) {
      setSaving(false)
      toast.error(res.error)
      return
    }
    if (apiKey.trim()) {
      await window.app.setMediaProviderKey(res.id, apiKey.trim())
    }
    setSaving(false)
    setLabel('')
    setBaseURL('')
    setModels('')
    setApiKey('')
    toast.success('Custom provider added')
    onAdded()
  }

  return (
    <div className="border-t border-border p-4">
      <p className="text-sm font-medium">Add OpenAI-compatible provider</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        For image proxies / aggregator gateways that expose an OpenAI-compatible <code>/images</code> endpoint.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name (e.g. My Gateway)" className="h-8 text-sm" />
        <Input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="Base URL (https://…/v1)" className="h-8 text-sm" />
        <Input value={models} onChange={(e) => setModels(e.target.value)} placeholder="Model ids, comma-separated" className="h-8 text-sm" />
        <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key (optional now)" className="h-8 text-sm" />
      </div>
      <div className="mt-2 flex justify-end">
        <Button size="sm" disabled={saving || !canSave} onClick={() => void submit()}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <><Plus className="size-3.5" />Add provider</>}
        </Button>
      </div>
    </div>
  )
}

export function MediaGenSettingsPage() {
  const [providers, setProviders] = useState<MediaProviderStatus[] | null>(null)

  const load = useCallback(() => {
    void window.app.getMediaProviders().then(setProviders)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-start gap-2">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">Image Generation</h2>
          <p className="text-sm text-muted-foreground">
            Configure providers for AI image generation. Keys are encrypted in your OS keychain and used by the
            generate_image tool and the image workbench.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border">
        <div className="p-4">
          <p className="text-sm font-medium">Providers</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Built-in providers need their own API key (matching env vars like OPENAI_API_KEY are a fallback). Add an
            OpenAI-compatible provider to route through a proxy or aggregator gateway.
          </p>
        </div>
        {!providers ? (
          <div className="flex items-center gap-2 border-t border-border p-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading…
          </div>
        ) : (
          providers.map((provider) => <ProviderRow key={provider.id} provider={provider} onChanged={load} />)
        )}
        <AddCustomProvider onAdded={load} />
      </div>
    </div>
  )
}
