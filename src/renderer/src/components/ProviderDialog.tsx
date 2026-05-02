import { useEffect, useState, useMemo } from 'react'
import { ChevronLeft, Eye, EyeOff, Loader2, Plus, RefreshCw, Trash2, X, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
import { parseEnvString, RESERVED_ENV_KEYS } from '@/lib/provider-env'
import { resolvePresetKey, getPresetByKey } from '@/lib/preset-match'
import { diffProviderAgainstPreset, type PresetSyncDiff } from '@/lib/preset-merge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ProviderLabel } from './ProviderLabel'
import { PresetSyncDialog } from './PresetSyncDialog'
import type { ApiProvider, CreateProviderRequest, UpdateProviderRequest, AgentProviderConfig, ProviderModelEnv, ModelBucket, ProviderModelSlot } from '../../../shared/agent-types'
import { MODEL_BUCKETS, expandProviderModelEnv, parseProviderModelEnv } from '../../../shared/agent-types'

interface AgentFormState {
  base_url: string
  extra_env: string
  model_env: ProviderModelEnv
}

interface FormState {
  name: string
  api_key: string
  agentForms: Record<string, AgentFormState>
}

type DialogStep = 'select' | 'form'

interface EnvPairs {
  visible: Array<{ key: string; value: string }>
  hidden: Array<{ key: string; value: string }>
}

function parseEnvPairs(json: string): EnvPairs {
  try {
    const obj = JSON.parse(json)
    const visible: Array<{ key: string; value: string }> = []
    const hidden: Array<{ key: string; value: string }> = []
    for (const [key, rawValue] of Object.entries(obj)) {
      const pair = { key, value: String(rawValue) }
      if (RESERVED_ENV_KEYS.has(key)) hidden.push(pair)
      else visible.push(pair)
    }
    return { visible, hidden }
  } catch {
    return { visible: [], hidden: [] }
  }
}

function serializeEnvPairs(pairs: EnvPairs): string {
  const obj: Record<string, string> = {}
  for (const p of pairs.hidden) obj[p.key] = p.value
  for (const p of pairs.visible) {
    const k = p.key.trim()
    if (k && !RESERVED_ENV_KEYS.has(k)) obj[k] = p.value
  }
  return JSON.stringify(obj)
}

function EnvEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation()
  const [pairs, setPairs] = useState<EnvPairs>(() => parseEnvPairs(value))
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  useEffect(() => {
    setPairs(parseEnvPairs(value))
  }, [value])

  const sync = (next: EnvPairs) => {
    setPairs(next)
    onChange(serializeEnvPairs(next))
  }

  const update = (index: number, field: 'key' | 'value', val: string) => {
    sync({
      ...pairs,
      visible: pairs.visible.map((p, i) => (i === index ? { ...p, [field]: val } : p)),
    })
  }

  const addRow = () => {
    setPairs((prev) => ({ ...prev, visible: [...prev.visible, { key: '', value: '' }] }))
  }

  const removeRow = (index: number) => {
    sync({ ...pairs, visible: pairs.visible.filter((_, i) => i !== index) })
  }

  const handlePaste = () => {
    const parsed = parseEnvString(pasteText).filter((p) => !RESERVED_ENV_KEYS.has(p.key))
    if (parsed.length === 0) {
      setPasteText('')
      setPasteOpen(false)
      return
    }
    const existingKeys = new Set(pairs.visible.map((p) => p.key).filter(Boolean))
    const newPairs = parsed.filter((p) => !existingKeys.has(p.key))
    sync({ ...pairs, visible: [...pairs.visible, ...newPairs] })
    setPasteText('')
    setPasteOpen(false)
  }

  return (
    <div className="flex flex-col gap-1.5">
      {pairs.visible.map((pair, i) => (
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
      <div className="flex items-center gap-2">
        <button type="button" onClick={addRow} className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground">
          <Plus className="size-3" /> {t('resources.providerDialog.addVariable')}
        </button>
        <button type="button" onClick={() => setPasteOpen((v) => !v)} className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground">
          <Plus className="size-3" /> {t('resources.providerDialog.pasteEnv')}
        </button>
      </div>
      {pasteOpen && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border p-2">
          <textarea
            className="min-h-[80px] rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="KEY1=value1&#10;export KEY2=value2&#10;# comment line"
          />
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => { setPasteOpen(false); setPasteText('') }} className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground">
              {t('common.cancel')}
            </button>
            <button type="button" onClick={handlePaste} className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground hover:bg-primary/90">
              {t('resources.providerDialog.applyPaste')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ModelEnvEditor({ value, onChange }: { value: ProviderModelEnv; onChange: (v: ProviderModelEnv) => void }) {
  const { t } = useTranslation()
  const bucketLabel: Record<ModelBucket, string> = {
    default: t('resources.providerDialog.bucketDefault'),
    opus: 'Opus',
    sonnet: 'Sonnet',
    haiku: 'Haiku',
    subagent: t('resources.providerDialog.bucketSubagent'),
  }

  const update = (bucket: ModelBucket, field: 'id' | 'name', v: string) => {
    const existing: ProviderModelSlot = value[bucket] ?? { id: '' }
    const nextSlot: ProviderModelSlot = { ...existing, [field]: v }
    const next: ProviderModelEnv = { ...value, [bucket]: nextSlot }
    if (!nextSlot.id && !nextSlot.name) delete next[bucket]
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-1.5">
      {MODEL_BUCKETS.map((bucket) => {
        const slot = value[bucket]
        return (
          <div key={bucket} className="flex items-center gap-1.5">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">{bucketLabel[bucket]}</span>
            <input
              className="w-[40%] rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
              value={slot?.id ?? ''}
              onChange={(e) => update(bucket, 'id', e.target.value)}
              placeholder={t('resources.providerDialog.modelIdPlaceholder')}
            />
            <input
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={slot?.name ?? ''}
              onChange={(e) => update(bucket, 'name', e.target.value)}
              placeholder={t('resources.providerDialog.modelNamePlaceholder')}
            />
          </div>
        )
      })}
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
  const { t } = useTranslation()
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
        {showDetails ? t('resources.providerDialog.envHide') : t('resources.providerDialog.envShow')}
      </button>
      {showDetails && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.baseUrl')}</span>
            <input
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
              value={form.base_url}
              onChange={(e) => onChange({ ...form, base_url: e.target.value })}
              placeholder="https://api.example.com"
            />
          </label>
          {hasModelEnv && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.modelMapping')}</span>
              <ModelEnvEditor value={form.model_env} onChange={(m) => onChange({ ...form, model_env: m })} />
            </div>
          )}
          <button
            type="button"
            className="self-start text-xs text-muted-foreground underline"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? t('resources.providerDialog.advancedHide') : t('resources.providerDialog.advancedShow')}
          </button>
          {showAdvanced && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.environmentVariables')}</span>
              <EnvEditor value={form.extra_env} onChange={(v) => onChange({ ...form, extra_env: v })} />
            </div>
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
      extra_env: form.extra_env,
      api_format: 'anthropic',
    }
  }
  return JSON.stringify(configs)
}

function parseAgentForm(config: AgentProviderConfig | undefined, presetConfig?: AgentPresetConfig): AgentFormState {
  if (!config) {
    return {
      base_url: presetConfig?.base_url ?? '',
      extra_env: presetConfig?.extra_env ?? '{}',
      model_env: presetConfig?.model_env ? { ...presetConfig.model_env } : {},
    }
  }
  return {
    base_url: config.base_url,
    extra_env: config.extra_env || '{}',
    model_env: parseProviderModelEnv(config.model_env),
  }
}

export function ProviderDialog({
  open,
  onOpenChange,
  editProvider,
  onSave,
  onDelete,
  agentFilter,
  autoSync,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editProvider: ApiProvider | null
  onSave: (data: CreateProviderRequest | (UpdateProviderRequest & { id: string })) => void
  onDelete?: (id: string) => void
  agentFilter?: AgentType
  autoSync?: boolean
}) {
  const { t } = useTranslation()
  const [step, setStep] = useState<DialogStep>('select')
  const [selectedPreset, setSelectedPreset] = useState<QuickPreset | null>(null)
  const [templateVals, setTemplateVals] = useState<Record<string, string>>({})
  const [form, setForm] = useState<FormState>({ name: '', api_key: '', agentForms: {} })
  const [activeAgentTab, setActiveAgentTab] = useState<AgentType>('claude')
  const [showApiKey, setShowApiKey] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [syncDialogOpen, setSyncDialogOpen] = useState(false)
  const [syncDiff, setSyncDiff] = useState<PresetSyncDiff | null>(null)

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
  const currentAgentForm = form.agentForms[activeAgentTab] || { base_url: '', extra_env: '{}', model_env: {} }
  const currentPresetConfig = matchedPreset?.agent_configs[activeAgentTab]

  const syncPreset = useMemo(() => {
    if (!editProvider) return null
    const key = resolvePresetKey(editProvider)
    return key ? getPresetByKey(key) ?? null : null
  }, [editProvider])

  const initialSyncDiff = useMemo(() => {
    if (!editProvider || !syncPreset) return null
    return diffProviderAgainstPreset(editProvider, syncPreset)
  }, [editProvider, syncPreset])

  const canSync = !!initialSyncDiff && initialSyncDiff.hasChanges

  const handleOpenSync = () => {
    if (!initialSyncDiff) return
    setSyncDiff(initialSyncDiff)
    setSyncDialogOpen(true)
  }

  const handleApplySync = (effective: PresetSyncDiff) => {
    if (!syncPreset || !editProvider) return
    const newForms: Record<string, AgentFormState> = { ...form.agentForms }
    for (const agentDiff of effective.perAgent) {
      const presetCfg = syncPreset.agent_configs[agentDiff.agent as keyof typeof syncPreset.agent_configs]
      const existing = newForms[agentDiff.agent]
      let nextBaseUrl = existing?.base_url ?? presetCfg?.base_url ?? ''
      let nextExtraStr = existing?.extra_env ?? presetCfg?.extra_env ?? '{}'
      let nextModelEnv: ProviderModelEnv = existing
        ? { ...existing.model_env }
        : { ...(presetCfg?.model_env ?? {}) }

      if (agentDiff.baseUrlMismatch) nextBaseUrl = agentDiff.baseUrlMismatch.preset

      if (Object.keys(agentDiff.extraEnvAdded).length > 0 || agentDiff.extraEnvChanged.length > 0) {
        const extra = (() => { try { return JSON.parse(nextExtraStr || '{}') } catch { return {} } })()
        for (const [k, v] of Object.entries(agentDiff.extraEnvAdded)) {
          if (!(k in extra)) extra[k] = v
        }
        for (const c of agentDiff.extraEnvChanged) {
          extra[c.key] = c.to
        }
        nextExtraStr = JSON.stringify(extra)
      }

      if (Object.keys(agentDiff.modelEnvSlotsAdded).length > 0 || agentDiff.modelEnvSlotsChanged.length > 0) {
        for (const [bucket, slot] of Object.entries(agentDiff.modelEnvSlotsAdded)) {
          if (slot && !nextModelEnv[bucket as ModelBucket]) nextModelEnv[bucket as ModelBucket] = slot
        }
        for (const c of agentDiff.modelEnvSlotsChanged) {
          nextModelEnv[c.slot] = c.to
        }
      }

      newForms[agentDiff.agent] = {
        base_url: nextBaseUrl,
        extra_env: nextExtraStr,
        model_env: nextModelEnv,
      }
    }

    let resolvedAgentForms = newForms
    if (matchedPreset?.templateValues && Object.keys(templateVals).length > 0) {
      resolvedAgentForms = {}
      for (const [agent, af] of Object.entries(newForms)) {
        resolvedAgentForms[agent] = {
          ...af,
          base_url: resolveTemplateValues(af.base_url, templateVals),
          extra_env: resolveTemplateValues(af.extra_env, templateVals),
          model_env: af.model_env,
        }
      }
    }
    const dbSupportedAgents: AgentType[] = (() => {
      try { return JSON.parse(editProvider.supported_agents || '["claude"]') as AgentType[] } catch { return ['claude'] }
    })()
    const nextSupportedAgents = Array.from(new Set([...dbSupportedAgents, ...(effective.supportedAgentsAdded as AgentType[])]))
    onSave({
      id: editProvider.id,
      name: form.name,
      api_key: form.api_key,
      supported_agents: JSON.stringify(nextSupportedAgents),
      agent_configs: buildAgentConfigs(resolvedAgentForms),
    })

    setSyncDialogOpen(false)
    setSyncDiff(null)
    onOpenChange(false)
  }

  useEffect(() => {
    if (open && autoSync && editProvider && initialSyncDiff?.hasChanges) {
      setSyncDiff(initialSyncDiff)
      setSyncDialogOpen(true)
    }
  }, [open, autoSync, editProvider, initialSyncDiff])

  const handleTest = async () => {
    setTestStatus('testing')
    setTestMessage('')
    try {
      const af = form.agentForms[activeAgentTab]
      if (!af) { setTestStatus('error'); setTestMessage(t('resources.providerDialog.noAgentConfig')); return }
      const mergedExtra = JSON.stringify({
        ...JSON.parse(af.extra_env || '{}'),
        ...expandProviderModelEnv(af.model_env),
      })
      const result = await window.app.testProvider({
        api_key: form.api_key,
        base_url: af.base_url || '',
        extra_env: mergedExtra,
      })
      if (result.success) {
        setTestStatus('success')
        setTestMessage(t('resources.providerDialog.connected'))
      } else {
        setTestStatus('error')
        setTestMessage(result.error || t('resources.providerDialog.connectionFailed'))
      }
    } catch (err) {
      setTestStatus('error')
      setTestMessage(err instanceof Error ? err.message : t('resources.providerDialog.unknownError'))
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
          extra_env: resolveTemplateValues(af.extra_env, templateVals),
          model_env: af.model_env,
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
              <DialogTitle>{t('resources.providerDialog.addTitle')}</DialogTitle>
              <DialogDescription>{t('resources.providerDialog.addDescription')}</DialogDescription>
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
                  {t('common.back')}
                </button>
              )}
              <DialogTitle className="sr-only">
                {editProvider?.name ?? selectedPreset?.name ?? t('resources.providerDialog.addTitle')}
              </DialogTitle>
              {editProvider
                ? <ProviderLabel provider={editProvider} fallback={editProvider.name} size={28} />
                : <ProviderLabel presetKey={selectedPreset?.key} fallback={selectedPreset?.name} size={28} />}
              <DialogDescription>
                {editProvider ? t('resources.providerDialog.editDescription') : selectedPreset?.description}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2">
              {showFields.includes('name') && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.name')}</span>
                  <input
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder={t('resources.providerDialog.namePlaceholder')}
                  />
                </label>
              )}
              {showFields.includes('api_key') && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.apiKey')}</span>
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
                {testStatus === 'testing' ? t('resources.providerDialog.testing') : testMessage}
              </p>
            )}
            <DialogFooter className="flex-row justify-between sm:justify-between">
              <div className="flex gap-2">
                {editProvider && onDelete && (
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => { onDelete(editProvider.id); onOpenChange(false) }}>
                    <Trash2 className="size-3.5" /> {t('resources.providerDialog.delete')}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={handleTest} disabled={testStatus === 'testing'}>
                  {testStatus === 'testing' ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                  {t('resources.providerDialog.test')}
                </Button>
                {editProvider && canSync && (
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="size-8" onClick={handleOpenSync} aria-label={t('resources.providerDialog.sync')}>
                          <RefreshCw className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">{t('resources.providerDialog.sync')}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
                <Button onClick={handleSubmit}>{editProvider ? t('resources.providerDialog.save') : t('resources.providers.connect')}</Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
      <PresetSyncDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        diff={syncDiff}
        onApply={handleApplySync}
      />
    </Dialog>
  )
}
