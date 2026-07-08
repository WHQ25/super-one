import { useMemo, useState } from 'react'
import { Check, ExternalLink, Eye, EyeOff, Loader2, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import type { ApiProvider, CreateProviderRequest, ProviderCapability } from '@superone/shared/agent-types'
import { expandProviderModelEnv, parseProviderCapabilities } from '@superone/shared/agent-types'
import { PlatformModelsPanel } from './PlatformModelsPanel'
import { uniqueKeyName } from '@/lib/provider-brands'
import {
  EnvEditor,
  ImageCapabilityEditor,
  ModelEnvEditor,
  buildAgentConfigs,
  buildCapabilities,
  parseAgentForm,
  type AgentFormState,
} from './ProviderDialog'

type Harness = 'claude' | 'codex'

function hasChatContent(f: AgentFormState): boolean {
  return !!f.base_url || Object.keys(f.model_env).length > 0 || (!!f.extra_env && f.extra_env !== '{}')
}

export function ProviderDetailPanel({
  provider,
  onSave,
  onCreate,
  onActivate,
  onDeactivate,
  apiKeyUrl,
  nameEditable = true,
  existingKeyNames = [],
  brandKey,
}: {
  provider: ApiProvider
  onSave: (id: string, data: { name: string; key_name: string; api_key: string; supported_agents: string; agent_configs: string; capabilities: string }) => Promise<void>
  onCreate?: (data: CreateProviderRequest) => Promise<void>
  onActivate: (id: string, harness: Harness) => Promise<void>
  onDeactivate: (harness: Harness) => Promise<void>
  apiKeyUrl?: string
  nameEditable?: boolean
  existingKeyNames?: string[]
  brandKey?: string | null
}) {
  const { t } = useTranslation()
  const isCreate = provider.id === ''
  const [name, setName] = useState(provider.name)
  const [keyName, setKeyName] = useState(provider.key_name)
  const [keyNameError, setKeyNameError] = useState('')
  const [apiKey, setApiKey] = useState(provider.api_key)
  const [showKey, setShowKey] = useState(false)
  const [harness, setHarness] = useState<Harness>('claude')
  const [agentForms, setAgentForms] = useState<Record<Harness, AgentFormState>>(() => {
    const configs = JSON.parse(provider.agent_configs || '{}')
    return { claude: parseAgentForm(configs.claude), codex: parseAgentForm(configs.codex) }
  })
  const [imageCapability, setImageCapability] = useState<ProviderCapability | null>(
    () => parseProviderCapabilities(provider.capabilities).find((c) => c.task === 'image') ?? null,
  )
  const [saving, setSaving] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testMessage, setTestMessage] = useState('')

  const form = agentForms[harness]
  const isActive = harness === 'claude' ? provider.is_active_claude === 1 : provider.is_active_codex === 1

  const updateForm = (patch: Partial<AgentFormState>) => setAgentForms((f) => ({ ...f, [harness]: { ...f[harness], ...patch } }))

  const activeConfigs = useMemo(
    () => Object.fromEntries(Object.entries(agentForms).filter(([, f]) => hasChatContent(f))),
    [agentForms],
  )

  const handleSave = async () => {
    const trimmedKeyName = keyName.trim()
    if (trimmedKeyName && existingKeyNames.includes(trimmedKeyName)) {
      setKeyNameError(t('resources.providers.keyNameDuplicate'))
      return
    }
    const finalKeyName = trimmedKeyName || uniqueKeyName('default', existingKeyNames)
    setKeyNameError('')
    setSaving(true)
    const agent_configs = buildAgentConfigs(activeConfigs)
    const data = {
      name,
      key_name: finalKeyName,
      api_key: apiKey,
      supported_agents: JSON.stringify(Object.keys(activeConfigs)),
      agent_configs,
      capabilities: buildCapabilities(agent_configs, imageCapability),
    }
    const action = isCreate && onCreate
      ? onCreate({ ...data, provider_type: provider.provider_type, category: provider.category })
      : onSave(provider.id, data)
    await action.finally(() => setSaving(false))
  }

  const handleTest = async () => {
    setTestStatus('testing')
    setTestMessage('')
    try {
      const mergedExtra = JSON.stringify({ ...JSON.parse(form.extra_env || '{}'), ...expandProviderModelEnv(form.model_env) })
      const result = harness === 'codex'
        ? await window.app.testCodexProvider({ api_key: apiKey, base_url: form.base_url || '', extra_env: mergedExtra, name, provider_id: provider.id })
        : await window.app.testProvider({ api_key: apiKey, base_url: form.base_url || '', extra_env: mergedExtra, provider_id: provider.id })
      setTestStatus(result.success ? 'success' : 'error')
      setTestMessage(result.success ? t('resources.providerDialog.connected') : (result.error || t('resources.providerDialog.connectionFailed')))
    } catch (err) {
      setTestStatus('error')
      setTestMessage(err instanceof Error ? err.message : t('resources.providerDialog.unknownError'))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {nameEditable && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.name')}</span>
          <input
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('resources.providerDialog.namePlaceholder')}
          />
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.keyName')}</span>
        <input
          className={`rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring ${keyNameError ? 'border-destructive' : 'border-border'}`}
          value={keyName}
          onChange={(e) => { setKeyName(e.target.value); if (keyNameError) setKeyNameError('') }}
          placeholder={t('resources.providerDialog.keyNamePlaceholder')}
        />
        {keyNameError && <span className="text-xs text-destructive">{keyNameError}</span>}
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.apiKey')}</span>
          {apiKeyUrl && (
            <button
              type="button"
              onClick={() => window.app.openExternalLink(apiKeyUrl)}
              className="flex items-center gap-1 text-xs text-primary opacity-80 transition-opacity hover:opacity-100"
            >
              <ExternalLink size={11} />
              {t('resources.providerDialog.getApiKey')}
            </button>
          )}
        </span>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 pr-9 text-sm outline-none focus:ring-1 focus:ring-ring"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
          />
          <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowKey((v) => !v)} tabIndex={-1}>
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </label>

      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
        <div className="flex items-center justify-between">
          <Tabs value={harness} onValueChange={(v) => setHarness(v as Harness)}>
            <TabsList className="h-7">
              <TabsTrigger value="claude" className="h-6 text-xs">Claude</TabsTrigger>
              <TabsTrigger value="codex" className="h-6 text-xs">Codex</TabsTrigger>
            </TabsList>
          </Tabs>
          {!isCreate && (
            <Button
              variant="outline"
              size="sm"
              className={`h-7 text-xs ${isActive ? 'border-primary/40 text-primary' : ''}`}
              onClick={() => (isActive ? onDeactivate(harness) : onActivate(provider.id, harness))}
            >
              {isActive ? <>{t('resources.providers.default')} <Check className="size-3.5" /></> : t('resources.providers.setDefault')}
            </Button>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.baseUrl')}</span>
          <input
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            value={form.base_url}
            onChange={(e) => updateForm({ base_url: e.target.value })}
            placeholder="https://api.example.com"
          />
        </label>

        {harness === 'claude' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.modelMapping')}</span>
            <ModelEnvEditor value={form.model_env} onChange={(m) => updateForm({ model_env: m })} />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.environmentVariables')}</span>
          <EnvEditor value={form.extra_env} onChange={(v) => updateForm({ extra_env: v })} />
        </div>
      </div>

      <ImageCapabilityEditor value={imageCapability} onChange={setImageCapability} />

      {testStatus !== 'idle' && (
        <p className={`text-xs ${testStatus === 'success' ? 'text-green-600 dark:text-green-400' : testStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
          {testStatus === 'testing' ? t('resources.providerDialog.testing') : testMessage}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleTest} disabled={testStatus === 'testing'}>
          {testStatus === 'testing' ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
          {t('resources.providerDialog.test')}
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {isCreate ? t('resources.providers.add') : t('resources.providerDialog.save')}
        </Button>
      </div>

      <div className="mt-2">
        <PlatformModelsPanel provider={provider} brandKey={brandKey} imageCapability={imageCapability} onImageCapabilityChange={setImageCapability} />
      </div>
    </div>
  )
}
