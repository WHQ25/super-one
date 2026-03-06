import { useEffect, useState, useMemo } from 'react'
import { ChevronLeft, Eye, EyeOff, Loader2, Plus, Trash2, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PRESETS, getPresetsByCategory, resolveTemplateValues, CATEGORY_LABELS, type QuickPreset, type AgentType, type AgentPresetConfig } from '@/lib/provider-presets'
import { MODEL_ENV_KEYS, splitEnv, mergeEnv } from '@/lib/provider-env'
import { ProviderLabel } from './ProvidersPage'
import type { ApiProvider, CreateProviderRequest, UpdateProviderRequest, AgentProviderConfig } from '../../../shared/agent-types'

interface AgentFormState {
  base_url: string
  extra_env: string
  model_env: Record<string, string>
  internal_env: Record<string, string>
}

interface FormState {
  name: string
  api_key: string
  agentForms: Record<string, AgentFormState>
}

type DialogStep = 'select' | 'form'

function parseEnvPairs(json: string): Array<{ key: string; value: string }> {
  try {
    const obj = JSON.parse(json)
    return Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }))
  } catch {
    return []
  }
}

function serializeEnvPairs(pairs: Array<{ key: string; value: string }>): string {
  const obj: Record<string, string> = {}
  for (const p of pairs) {
    if (p.key.trim()) obj[p.key.trim()] = p.value
  }
  return JSON.stringify(obj)
}

function EnvEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [pairs, setPairs] = useState(() => parseEnvPairs(value))

  useEffect(() => {
    setPairs(parseEnvPairs(value))
  }, [value])

  const sync = (next: Array<{ key: string; value: string }>) => {
    setPairs(next)
    onChange(serializeEnvPairs(next))
  }

  const update = (index: number, field: 'key' | 'value', val: string) => {
    sync(pairs.map((p, i) => (i === index ? { ...p, [field]: val } : p)))
  }

  const addRow = () => {
    setPairs((prev) => [...prev, { key: '', value: '' }])
  }

  const removeRow = (index: number) => {
    sync(pairs.filter((_, i) => i !== index))
  }

  return (
    <div className="flex flex-col gap-1.5">
      {pairs.map((pair, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            className="w-[40%] rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            value={pair.key}
            onChange={(e) => update(i, 'key', e.target.value)}
            placeholder="KEY"
          />
          <input
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            value={pair.value}
            onChange={(e) => update(i, 'value', e.target.value)}
            placeholder="value"
          />
          <button type="button" onClick={() => removeRow(i)} className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={addRow} className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground">
        <Plus className="size-3" /> Add variable
      </button>
    </div>
  )
}

function AgentConfigForm({
  form,
  onChange,
  preset,
  isEdit,
}: {
  agentType: AgentType
  form: AgentFormState
  onChange: (f: AgentFormState) => void
  preset?: AgentPresetConfig
  isEdit: boolean
}) {
  const [showDetails, setShowDetails] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const hasModelEnv = Object.keys(form.model_env).length > 0 || isEdit || (preset?.model_env && Object.keys(preset.model_env).length > 0)

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        className="self-start text-xs text-muted-foreground underline"
        onClick={() => setShowDetails(!showDetails)}
      >
        {showDetails ? 'Hide' : 'Show'} environment variables
      </button>
      {showDetails && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Base URL</span>
            <input
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
              value={form.base_url}
              onChange={(e) => onChange({ ...form, base_url: e.target.value })}
              placeholder="https://api.example.com"
            />
          </label>
          {hasModelEnv && (
            <div className="flex flex-col gap-1.5">
              {MODEL_ENV_KEYS.map(({ key, label }) => {
                if (!(key in form.model_env) && !preset?.model_env?.[key] && !isEdit) return null
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{label}</span>
                    <input
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                      value={form.model_env[key] ?? ''}
                      onChange={(e) => onChange({ ...form, model_env: { ...form.model_env, [key]: e.target.value } })}
                      placeholder={key}
                    />
                  </div>
                )
              })}
            </div>
          )}
          <button
            type="button"
            className="self-start text-xs text-muted-foreground underline"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? 'Hide' : 'Show'} advanced options
          </button>
          {showAdvanced && (
            <EnvEditor value={form.extra_env} onChange={(v) => onChange({ ...form, extra_env: v })} />
          )}
        </>
      )}
    </div>
  )
}

function buildAgentConfigs(agentForms: Record<string, AgentFormState>): string {
  const configs: Record<string, AgentProviderConfig> = {}
  for (const [agent, form] of Object.entries(agentForms)) {
    configs[agent] = {
      base_url: form.base_url,
      model_env: JSON.stringify(form.model_env),
      extra_env: mergeEnv(form.extra_env, form.model_env, form.internal_env),
      api_format: 'anthropic',
    }
  }
  return JSON.stringify(configs)
}

function parseAgentForm(config: AgentProviderConfig | undefined, presetConfig?: AgentPresetConfig): AgentFormState {
  if (!config) {
    return {
      base_url: presetConfig?.base_url ?? '',
      extra_env: '{}',
      model_env: presetConfig?.model_env ? { ...presetConfig.model_env } : {},
      internal_env: {},
    }
  }
  const fullEnv = config.extra_env || '{}'
  const { modelEnv, internalEnv, restEnv } = splitEnv(fullEnv)
  return {
    base_url: config.base_url,
    extra_env: restEnv,
    model_env: modelEnv,
    internal_env: internalEnv,
  }
}

export function ProviderDialog({
  open,
  onOpenChange,
  editProvider,
  onSave,
  onDelete,
  agentFilter,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editProvider: ApiProvider | null
  onSave: (data: CreateProviderRequest | (UpdateProviderRequest & { id: string })) => void
  onDelete?: (id: string) => void
  agentFilter?: AgentType
}) {
  const [step, setStep] = useState<DialogStep>('select')
  const [selectedPreset, setSelectedPreset] = useState<QuickPreset | null>(null)
  const [templateVals, setTemplateVals] = useState<Record<string, string>>({})
  const [form, setForm] = useState<FormState>({ name: '', api_key: '', agentForms: {} })
  const [activeAgentTab, setActiveAgentTab] = useState<AgentType>('claude')
  const [showApiKey, setShowApiKey] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testMessage, setTestMessage] = useState('')

  useEffect(() => {
    if (!open) return
    if (editProvider) {
      const configs = JSON.parse(editProvider.agent_configs || '{}')
      const agentForms: Record<string, AgentFormState> = {}
      for (const [agent, config] of Object.entries(configs)) {
        agentForms[agent] = parseAgentForm(config as AgentProviderConfig)
      }
      setForm({ name: editProvider.name, api_key: editProvider.api_key, agentForms })
      setStep('form')
      setSelectedPreset(null)
      const agents = JSON.parse(editProvider.supported_agents || '["claude"]') as AgentType[]
      setActiveAgentTab(agents[0] || 'claude')
      setShowApiKey(false)
      setTestStatus('idle')
      setTestMessage('')
    } else {
      setStep('select')
      setSelectedPreset(null)
      setShowApiKey(false)
      setTestStatus('idle')
      setTestMessage('')
    }
  }, [open, editProvider])

  const handlePresetSelect = (preset: QuickPreset) => {
    setSelectedPreset(preset)
    const agentForms: Record<string, AgentFormState> = {}
    for (const [agent, config] of Object.entries(preset.agent_configs)) {
      agentForms[agent] = parseAgentForm(undefined, config)
    }
    setForm({
      name: preset.name === 'Custom API' ? '' : preset.name,
      api_key: '',
      agentForms,
    })
    if (preset.templateValues) {
      const vals: Record<string, string> = {}
      for (const [k, v] of Object.entries(preset.templateValues)) {
        vals[k] = v.defaultValue ?? ''
      }
      setTemplateVals(vals)
    } else {
      setTemplateVals({})
    }
    setActiveAgentTab(preset.supported_agents[0] || 'claude')
    setStep('form')
  }

  const matchedPreset = useMemo(() => {
    if (selectedPreset) return selectedPreset
    if (!editProvider) return null
    const configs = JSON.parse(editProvider.agent_configs || '{}')
    const claudeUrl = configs.claude?.base_url ?? ''
    return PRESETS.find((p) => {
      const pUrl = p.agent_configs.claude?.base_url
      return pUrl && claudeUrl && claudeUrl === pUrl
    }) ?? null
  }, [selectedPreset, editProvider])

  const supportedAgents: AgentType[] = matchedPreset
    ? matchedPreset.supported_agents
    : editProvider
      ? (JSON.parse(editProvider.supported_agents || '["claude"]') as AgentType[])
      : ['claude', 'codex']

  const showFields = matchedPreset?.fields ?? ['name', 'api_key'] as const
  const currentAgentForm = form.agentForms[activeAgentTab] || { base_url: '', extra_env: '{}', model_env: {}, internal_env: {} }
  const currentPresetConfig = matchedPreset?.agent_configs[activeAgentTab]

  const handleTest = async () => {
    setTestStatus('testing')
    setTestMessage('')
    try {
      const af = form.agentForms[activeAgentTab]
      if (!af) { setTestStatus('error'); setTestMessage('No config for this agent'); return }
      const result = await window.app.testProvider({
        api_key: form.api_key,
        base_url: af.base_url || '',
        extra_env: mergeEnv(af.extra_env, af.model_env, af.internal_env),
      })
      if (result.success) {
        setTestStatus('success')
        setTestMessage(`Found ${result.models} models`)
      } else {
        setTestStatus('error')
        setTestMessage(result.error || 'Connection failed')
      }
    } catch (err) {
      setTestStatus('error')
      setTestMessage(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const handleSubmit = () => {
    let resolvedAgentForms = form.agentForms
    if (matchedPreset?.templateValues && Object.keys(templateVals).length > 0) {
      resolvedAgentForms = {}
      for (const [agent, af] of Object.entries(form.agentForms)) {
        resolvedAgentForms[agent] = {
          ...af,
          base_url: resolveTemplateValues(af.base_url, templateVals),
          extra_env: resolveTemplateValues(mergeEnv(af.extra_env, af.model_env, af.internal_env), templateVals),
          model_env: af.model_env,
          internal_env: af.internal_env,
        }
      }
    }
    const agentConfigs = buildAgentConfigs(resolvedAgentForms)
    const supportedAgentsStr = JSON.stringify(supportedAgents)

    if (editProvider) {
      onSave({
        id: editProvider.id,
        name: form.name,
        api_key: form.api_key,
        supported_agents: supportedAgentsStr,
        agent_configs: agentConfigs,
      })
    } else {
      onSave({
        name: form.name || selectedPreset?.name || 'Provider',
        provider_type: selectedPreset?.provider_type ?? 'custom',
        api_key: form.api_key,
        category: selectedPreset?.category ?? 'custom',
        supported_agents: supportedAgentsStr,
        agent_configs: agentConfigs,
      })
    }
    onOpenChange(false)
  }

  const updateAgentForm = (af: AgentFormState) => {
    setForm((f) => ({ ...f, agentForms: { ...f.agentForms, [activeAgentTab]: af } }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {step === 'select' ? (
          <>
            <DialogHeader>
              <DialogTitle>Add Provider</DialogTitle>
              <DialogDescription>Select a provider template to get started</DialogDescription>
            </DialogHeader>
            <div className="max-h-80 space-y-3 overflow-y-auto py-2">
              {Array.from(getPresetsByCategory(
                agentFilter ? PRESETS.filter((p) => p.supported_agents.includes(agentFilter)) : PRESETS
              )).map(([category, items]) => (
                <div key={category}>
                  <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {CATEGORY_LABELS[category]}
                  </div>
                  <div className="space-y-0.5">
                    {items.map((preset) => (
                      <button
                        key={preset.key}
                        onClick={() => handlePresetSelect(preset)}
                        className="flex w-full flex-col gap-1 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted"
                      >
                        <div className="flex items-center gap-2">
                          <ProviderLabel presetKey={preset.key} fallback={preset.name} size={34} />
                        </div>
                        <p className="text-xs text-muted-foreground">{preset.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <DialogHeader className={editProvider ? '' : 'pt-6'}>
              {!editProvider && (
                <button
                  onClick={() => setStep('select')}
                  className="absolute top-4 left-4 z-10 flex items-center gap-0.5 text-xs text-muted-foreground opacity-70 transition-opacity hover:opacity-100"
                >
                  <ChevronLeft className="size-3.5" />
                  Back
                </button>
              )}
              {editProvider
                ? <ProviderLabel provider={editProvider} fallback={editProvider.name} size={28} />
                : <ProviderLabel presetKey={selectedPreset?.key} fallback={selectedPreset?.name} size={28} />}
              <DialogDescription>
                {editProvider ? 'Update provider configuration' : selectedPreset?.description}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2">
              {showFields.includes('name') && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Name</span>
                  <input
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Provider name"
                  />
                </label>
              )}
              {showFields.includes('api_key') && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">API Key</span>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      className="w-full rounded-md border border-border bg-background px-3 py-1.5 pr-9 text-sm outline-none focus:ring-1 focus:ring-ring"
                      value={form.api_key}
                      onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                      placeholder="sk-..."
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowApiKey((v) => !v)}
                      tabIndex={-1}
                    >
                      {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </label>
              )}
              {matchedPreset?.endpointCandidates && matchedPreset.endpointCandidates.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {matchedPreset.endpointCandidates.map((url) => {
                    const af = form.agentForms[activeAgentTab]
                    const agentUrl = activeAgentTab === 'codex' ? url + '/v1' : url
                    return (
                      <button
                        key={url}
                        type="button"
                        onClick={() => {
                          const newForms = { ...form.agentForms }
                          for (const [agent, f] of Object.entries(newForms)) {
                            newForms[agent] = { ...f, base_url: agent === 'codex' ? url + '/v1' : url }
                          }
                          setForm((prev) => ({ ...prev, agentForms: newForms }))
                        }}
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                          af?.base_url === agentUrl
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:border-primary/50'
                        }`}
                      >
                        {url}
                      </button>
                    )
                  })}
                </div>
              )}
              {matchedPreset?.templateValues && (
                <div className="flex flex-col gap-2">
                  {Object.entries(matchedPreset.templateValues).map(([key, config]) => (
                    <label key={key} className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-muted-foreground">{config.label}</span>
                      <input
                        className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                        value={templateVals[key] ?? config.defaultValue ?? ''}
                        onChange={(e) => setTemplateVals((v) => ({ ...v, [key]: e.target.value }))}
                        placeholder={config.placeholder}
                      />
                    </label>
                  ))}
                </div>
              )}
              {supportedAgents.length > 1 && (
                <div className="flex gap-1 rounded-lg bg-muted p-1">
                  {supportedAgents.map((agent) => (
                    <button
                      key={agent}
                      type="button"
                      onClick={() => setActiveAgentTab(agent)}
                      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        activeAgentTab === agent
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {agent === 'claude' ? 'Claude Code' : 'Codex'}
                    </button>
                  ))}
                </div>
              )}
              <AgentConfigForm
                agentType={activeAgentTab}
                form={currentAgentForm}
                onChange={updateAgentForm}
                preset={currentPresetConfig}
                isEdit={!!editProvider}
              />
            </div>
            {testStatus !== 'idle' && (
              <p className={`text-xs ${testStatus === 'success' ? 'text-green-600 dark:text-green-400' : testStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                {testStatus === 'testing' ? 'Testing connection...' : testMessage}
              </p>
            )}
            <DialogFooter className="flex-row justify-between sm:justify-between">
              <div className="flex gap-2">
                {editProvider && onDelete && (
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => { onDelete(editProvider.id); onOpenChange(false) }}>
                    <Trash2 className="size-3.5" /> Delete
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={handleTest} disabled={testStatus === 'testing'}>
                  {testStatus === 'testing' ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                  Test
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={handleSubmit}>{editProvider ? 'Save' : 'Connect'}</Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
