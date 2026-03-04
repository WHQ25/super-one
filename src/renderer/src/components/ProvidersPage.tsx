import { type ReactNode, useEffect, useState, useCallback, useMemo } from 'react'
import { Check, ChevronLeft, Eye, EyeOff, Globe, Loader2, Plus, Server, Trash2, X, Zap } from 'lucide-react'
import { Anthropic, OpenRouter, Zhipu, Kimi, Minimax, Volcengine, Bailian, Bedrock, Google } from '@lobehub/icons'
import { useSettingsStore } from '@/stores/settings'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { IconType } from '@lobehub/icons'
import type { ApiProvider, CreateProviderRequest, UpdateProviderRequest } from '../../../shared/agent-types'

interface BrandEntry {
  Mono: IconType
  Color?: IconType
  Text: IconType
}

const BRANDS: Record<string, BrandEntry> = {
  anthropic: { Mono: Anthropic, Text: Anthropic.Text },
  openrouter: { Mono: OpenRouter, Text: OpenRouter.Text },
  zhipu: { Mono: Zhipu, Color: Zhipu.Color, Text: Zhipu.Text },
  kimi: { Mono: Kimi, Color: Kimi.Color, Text: Kimi.Text },
minimax: { Mono: Minimax, Color: Minimax.Color, Text: Minimax.Text },
  volcengine: { Mono: Volcengine, Color: Volcengine.Color, Text: Volcengine.Text },
  bailian: { Mono: Bailian, Color: Bailian.Color, Text: Bailian.Text },
  bedrock: { Mono: Bedrock, Color: Bedrock.Color, Text: Bedrock.Text },
  google: { Mono: Google, Color: Google.Color, Text: Google.Brand },
}

const PRESET_PROVIDER_KEY: Record<string, string> = {
  'anthropic-official': 'anthropic',
  'openrouter': 'openrouter',
  'glm-cn': 'zhipu',
  'glm-global': 'zhipu',
  'kimi': 'kimi',
'minimax-cn': 'minimax',
  'minimax-global': 'minimax',
  'volcengine': 'volcengine',
  'bailian': 'bailian',
  'bedrock': 'bedrock',
  'vertex': 'google',
}

function resolveProviderKey(provider: ApiProvider): string | null {
  const url = provider.base_url.toLowerCase()
  const name = provider.name.toLowerCase()
  if (url.includes('anthropic.com') || name.includes('anthropic')) return 'anthropic'
  if (url.includes('openrouter') || name.includes('openrouter')) return 'openrouter'
  if (url.includes('bigmodel.cn') || url.includes('z.ai') || name.includes('glm') || name.includes('zhipu')) return 'zhipu'
  if (url.includes('kimi') || name.includes('kimi')) return 'kimi'
if (url.includes('minimax') || name.includes('minimax')) return 'minimax'
  if (url.includes('volces.com') || url.includes('volcengine') || name.includes('volcengine') || name.includes('ark')) return 'volcengine'
  if (url.includes('dashscope') || url.includes('bailian') || name.includes('bailian')) return 'bailian'
  if (provider.provider_type === 'bedrock' || name.includes('bedrock')) return 'bedrock'
  if (provider.provider_type === 'vertex' || name.includes('vertex')) return 'google'
  return null
}

function ProviderLabel({ presetKey, provider, fallback, size = 44 }: { presetKey?: string; provider?: ApiProvider; fallback?: string; size?: number }): ReactNode {
  const key = presetKey ? PRESET_PROVIDER_KEY[presetKey] : provider ? resolveProviderKey(provider) : null
  const brand = key ? BRANDS[key] : null
  if (brand) {
    const IconComp = brand.Color ?? brand.Mono
    return (
      <span className="inline-flex items-center gap-1.5">
        <IconComp size={size} />
        <brand.Text size={size * 0.75} />
      </span>
    )
  }
  return <span className="flex items-center gap-2 text-sm font-medium"><Globe className="size-5 text-muted-foreground" />{fallback}</span>
}

import { MODEL_ENV_KEYS, splitEnv, mergeEnv } from '@/lib/provider-env'

interface QuickPreset {
  key: string
  name: string
  description: string
  provider_type: string
  base_url: string
  extra_env: string
  fields: Array<'name' | 'api_key' | 'base_url' | 'extra_env'>
  showEnvByDefault?: boolean
  model_env?: Record<string, string>
}

const QUICK_PRESETS: QuickPreset[] = [
  {
    key: 'anthropic-official',
    name: 'Anthropic',
    description: 'Direct access to Claude models via the official Anthropic API',
    provider_type: 'anthropic',
    base_url: 'https://api.anthropic.com',
    extra_env: '{}',
    fields: ['api_key'],
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified API gateway — access Claude and 200+ models through a single key',
    provider_type: 'openrouter',
    base_url: 'https://openrouter.ai/api',
    extra_env: '{"ANTHROPIC_API_KEY":""}',
    fields: ['api_key'],
  },
  {
    key: 'glm-cn',
    name: 'GLM (CN)',
    description: '智谱 GLM 编程套餐 — 中国区，支持 Claude 协议兼容调用',
    provider_type: 'custom',
    base_url: 'https://open.bigmodel.cn/api/anthropic',
    extra_env: '{"API_TIMEOUT_MS":"3000000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","ANTHROPIC_AUTH_TOKEN":""}',
    fields: ['api_key'],
    model_env: { ANTHROPIC_MODEL: 'glm-4.7', ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-4.7', ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.5-air' },
  },
  {
    key: 'glm-global',
    name: 'GLM (Global)',
    description: 'Zhipu GLM Code Plan — Global endpoint for international users',
    provider_type: 'custom',
    base_url: 'https://api.z.ai/api/anthropic',
    extra_env: '{"API_TIMEOUT_MS":"3000000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","ANTHROPIC_AUTH_TOKEN":""}',
    fields: ['api_key'],
    model_env: { ANTHROPIC_MODEL: 'glm-4.7', ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-4.7', ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.5-air' },
  },
  {
    key: 'kimi',
    name: 'Kimi',
    description: 'Kimi 编程套餐 — 月之暗面旗下代码智能助手',
    provider_type: 'custom',
    base_url: 'https://api.kimi.com/coding/',
    extra_env: '{}',
    fields: ['api_key'],
    model_env: { ANTHROPIC_MODEL: 'kimi-k2', ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k2', ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k2', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-k2' },
  },
{
    key: 'minimax-cn',
    name: 'MiniMax (CN)',
    description: 'MiniMax 编程套餐 — 中国区，海螺 AI 代码模型',
    provider_type: 'custom',
    base_url: 'https://api.minimaxi.com/anthropic',
    extra_env: '{"API_TIMEOUT_MS":"3000000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","ANTHROPIC_AUTH_TOKEN":""}',
    fields: ['api_key'],
    model_env: { ANTHROPIC_MODEL: 'MiniMax-M2.5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'MiniMax-M2.5', ANTHROPIC_DEFAULT_OPUS_MODEL: 'MiniMax-M2.5', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'MiniMax-M2.5' },
  },
  {
    key: 'minimax-global',
    name: 'MiniMax (Global)',
    description: 'MiniMax Code Plan — Global endpoint for international users',
    provider_type: 'custom',
    base_url: 'https://api.minimax.io/anthropic',
    extra_env: '{"API_TIMEOUT_MS":"3000000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","ANTHROPIC_AUTH_TOKEN":""}',
    fields: ['api_key'],
    model_env: { ANTHROPIC_MODEL: 'MiniMax-M2.5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'MiniMax-M2.5', ANTHROPIC_DEFAULT_OPUS_MODEL: 'MiniMax-M2.5', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'MiniMax-M2.5' },
  },
  {
    key: 'volcengine',
    name: 'Volcengine Ark',
    description: '火山引擎方舟平台 — 聚合豆包、GLM、DeepSeek、Kimi 等多模型',
    provider_type: 'custom',
    base_url: 'https://ark.cn-beijing.volces.com/api/coding',
    extra_env: '{"API_TIMEOUT_MS":"3000000","ANTHROPIC_AUTH_TOKEN":""}',
    fields: ['api_key'],
    model_env: { ANTHROPIC_MODEL: 'ark-code-latest', ANTHROPIC_DEFAULT_SONNET_MODEL: 'ark-code-latest', ANTHROPIC_DEFAULT_OPUS_MODEL: 'ark-code-latest', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'ark-code-latest' },
  },
  {
    key: 'bailian',
    name: 'Aliyun Bailian',
    description: '阿里云百炼平台 — 聚合通义千问、GLM、Kimi、MiniMax 等多模型',
    provider_type: 'custom',
    base_url: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    extra_env: '{"ANTHROPIC_AUTH_TOKEN":""}',
    fields: ['api_key'],
    model_env: { ANTHROPIC_MODEL: 'qwen3.5-plus', ANTHROPIC_DEFAULT_SONNET_MODEL: 'qwen3.5-plus', ANTHROPIC_DEFAULT_OPUS_MODEL: 'qwen3.5-plus', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen3-coder-next' },
  },
  {
    key: 'bedrock',
    name: 'AWS Bedrock',
    description: 'Amazon Bedrock — run Claude on AWS infrastructure with IAM authentication',
    provider_type: 'bedrock',
    base_url: '',
    extra_env: '{"CLAUDE_CODE_USE_BEDROCK":"1","AWS_REGION":"us-east-1","AWS_ACCESS_KEY_ID":"","AWS_SECRET_ACCESS_KEY":"","AWS_SESSION_TOKEN":""}',
    fields: ['extra_env'],
    showEnvByDefault: true,
  },
  {
    key: 'vertex',
    name: 'Google Vertex',
    description: 'Google Vertex AI — run Claude on GCP infrastructure with service account authentication',
    provider_type: 'vertex',
    base_url: '',
    extra_env: '{"CLAUDE_CODE_USE_VERTEX":"1","CLOUD_ML_REGION":"global","ANTHROPIC_VERTEX_PROJECT_ID":""}',
    fields: ['extra_env'],
    showEnvByDefault: true,
  },
  {
    key: 'litellm',
    name: 'LiteLLM',
    description: 'LiteLLM proxy — route requests through a local or remote LiteLLM gateway',
    provider_type: 'custom',
    base_url: 'http://localhost:4000',
    extra_env: '{}',
    fields: ['api_key', 'base_url'],
  },
  {
    key: 'custom-api',
    name: 'Custom API',
    description: 'Connect any Anthropic-compatible API endpoint with custom base URL and credentials',
    provider_type: 'custom',
    base_url: '',
    extra_env: '{}',
    fields: ['name', 'api_key', 'base_url', 'extra_env'],
    model_env: {},
  },
]

function ProviderRow({
  provider,
  onEdit,
  onDelete,
  onActivate,
}: {
  provider: ApiProvider
  onEdit: () => void
  onDelete: () => void
  onActivate: () => void
}) {
  const isActive = provider.is_active === 1

  return (
    <div className="flex cursor-pointer items-center justify-between rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/50" onClick={onEdit}>
      <div className="flex items-center gap-3 overflow-hidden">
        <ProviderLabel provider={provider} fallback={provider.name} size={28} />
        {provider.base_url && (
          <span className="truncate text-xs text-muted-foreground">{provider.base_url}</span>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        className={`h-7 shrink-0 text-xs ${isActive ? 'border-green-500/40 text-green-600 hover:bg-green-50 hover:text-green-600 dark:text-green-400 dark:hover:bg-green-950' : ''}`}
        onClick={(e) => { e.stopPropagation(); if (!isActive) onActivate() }}
      >
        {isActive ? 'Connected' : 'Connect'} {isActive && <Check className="size-3.5" />}
      </Button>
    </div>
  )
}

interface FormState {
  name: string
  api_key: string
  base_url: string
  extra_env: string
  model_env: Record<string, string>
  internal_env: Record<string, string>
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

function ProviderDialog({
  open,
  onOpenChange,
  editProvider,
  onSave,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editProvider: ApiProvider | null
  onSave: (data: CreateProviderRequest | (UpdateProviderRequest & { id: string })) => void
  onDelete?: (id: string) => void
}) {
  const [step, setStep] = useState<DialogStep>('select')
  const [selectedPreset, setSelectedPreset] = useState<QuickPreset | null>(null)
  const [form, setForm] = useState<FormState>({
    name: '',
    api_key: '',
    base_url: '',
    extra_env: '{}',
    model_env: {},
    internal_env: {},
  })
  const [showModels, setShowModels] = useState(false)
  const [showEnv, setShowEnv] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testMessage, setTestMessage] = useState('')

  useEffect(() => {
    if (!open) return
    if (editProvider) {
      const { modelEnv, internalEnv, restEnv } = splitEnv(editProvider.extra_env || '{}')
      setForm({
        name: editProvider.name,
        api_key: editProvider.api_key,
        base_url: editProvider.base_url,
        extra_env: restEnv,
        model_env: modelEnv,
        internal_env: internalEnv,
      })
      setStep('form')
      setSelectedPreset(null)
      setShowModels(Object.keys(modelEnv).length > 0)
      setShowEnv(false)
      setShowApiKey(false)
      setTestStatus('idle')
      setTestMessage('')
    } else {
      setStep('select')
      setSelectedPreset(null)
      setShowModels(false)
      setShowEnv(false)
      setShowApiKey(false)
      setTestStatus('idle')
      setTestMessage('')
    }
  }, [open, editProvider])

  const handlePresetSelect = (preset: QuickPreset) => {
    setSelectedPreset(preset)
    const { internalEnv, restEnv } = splitEnv(preset.extra_env)
    setForm({
      name: preset.name === 'Custom API' ? '' : preset.name,
      api_key: '',
      base_url: preset.base_url,
      extra_env: restEnv,
      model_env: preset.model_env ? { ...preset.model_env } : {},
      internal_env: internalEnv,
    })
    setShowModels(!!(preset.model_env && Object.keys(preset.model_env).length > 0))
    setShowEnv(!!preset.showEnvByDefault)
    setStep('form')
  }

  const matchedPreset = useMemo(() => {
    if (selectedPreset) return selectedPreset
    if (!editProvider) return null
    return QUICK_PRESETS.find((p) => p.base_url && editProvider.base_url === p.base_url) ?? null
  }, [selectedPreset, editProvider])
  const fields = matchedPreset?.fields ?? ['name', 'api_key', 'base_url', 'extra_env'] as const
  const hasModelEnv = Object.keys(form.model_env).length > 0 || (editProvider && !selectedPreset) || matchedPreset?.model_env !== undefined

  const handleTest = async () => {
    setTestStatus('testing')
    setTestMessage('')
    try {
      const result = await window.app.testProvider({
        api_key: form.api_key,
        base_url: form.base_url || selectedPreset?.base_url || '',
        extra_env: mergeEnv(form.extra_env, form.model_env, form.internal_env),
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
    const finalEnv = mergeEnv(form.extra_env, form.model_env, form.internal_env)

    if (editProvider) {
      onSave({
        id: editProvider.id,
        name: form.name,
        api_key: form.api_key,
        base_url: form.base_url,
        extra_env: finalEnv,
      })
    } else {
      onSave({
        name: form.name || selectedPreset?.name || 'Provider',
        provider_type: selectedPreset?.provider_type ?? 'custom',
        api_key: form.api_key,
        base_url: form.base_url || selectedPreset?.base_url || '',
        extra_env: finalEnv,
      })
    }
    onOpenChange(false)
  }

  const showField = (f: string) => fields.includes(f as typeof fields[number])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {step === 'select' ? (
          <>
            <DialogHeader>
              <DialogTitle>Add Provider</DialogTitle>
              <DialogDescription>Select a provider template to get started</DialogDescription>
            </DialogHeader>
            <div className="max-h-80 space-y-1 overflow-y-auto py-2">
              {QUICK_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => handlePresetSelect(preset)}
                  className="flex w-full flex-col gap-1 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted"
                >
                  <ProviderLabel presetKey={preset.key} fallback={preset.name} size={34} />
                  <p className="text-xs text-muted-foreground">{preset.description}</p>
                </button>
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
              {showField('name') && (
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
              {showField('api_key') && (
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
              {showField('base_url') && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Base URL</span>
                  <input
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                    value={form.base_url}
                    onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                    placeholder="https://api.example.com"
                  />
                </label>
              )}
              {hasModelEnv && (
                <>
                  <button
                    type="button"
                    className="self-start text-xs text-muted-foreground underline"
                    onClick={() => setShowModels(!showModels)}
                  >
                    {showModels ? 'Hide' : 'Show'} environment variables
                  </button>
                  {showModels && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        {MODEL_ENV_KEYS.map(({ key, label }) => {
                          if (!(key in form.model_env) && !matchedPreset?.model_env?.[key] && !editProvider) return null
                          return (
                            <div key={key} className="flex items-center gap-2">
                              <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{label}</span>
                              <input
                                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                                value={form.model_env[key] ?? ''}
                                onChange={(e) => setForm((f) => ({ ...f, model_env: { ...f.model_env, [key]: e.target.value } }))}
                                placeholder={key}
                              />
                            </div>
                          )
                        })}
                      </div>
                      <button
                        type="button"
                        className="self-start text-xs text-muted-foreground underline"
                        onClick={() => setShowEnv(!showEnv)}
                      >
                        {showEnv ? 'Hide' : 'Show'} advanced options
                      </button>
                      {showEnv && (
                        <EnvEditor value={form.extra_env} onChange={(v) => setForm((f) => ({ ...f, extra_env: v }))} />
                      )}
                    </>
                  )}
                </>
              )}
              {!hasModelEnv && showField('extra_env') && (
                <>
                  <button
                    type="button"
                    className="self-start text-xs text-muted-foreground underline"
                    onClick={() => setShowEnv(!showEnv)}
                  >
                    {showEnv ? 'Hide' : 'Show'} environment variables
                  </button>
                  {showEnv && (
                    <EnvEditor value={form.extra_env} onChange={(v) => setForm((f) => ({ ...f, extra_env: v }))} />
                  )}
                </>
              )}
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

export function ProvidersPage() {
  const { providers, fetchProviders, createProvider, updateProvider, deleteProvider, activateProvider, deactivateAllProviders } = useSettingsStore()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ApiProvider | null>(null)

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  const handleAdd = useCallback(() => {
    setEditingProvider(null)
    setDialogOpen(true)
  }, [])

  const handleEdit = useCallback((provider: ApiProvider) => {
    setEditingProvider(provider)
    setDialogOpen(true)
  }, [])

  const handleSave = useCallback(async (data: CreateProviderRequest | (UpdateProviderRequest & { id: string })) => {
    if ('id' in data) {
      const { id, ...rest } = data
      await updateProvider(id, rest)
    } else {
      await createProvider(data)
    }
  }, [createProvider, updateProvider])

  const handleDelete = useCallback(async (id: string) => {
    await deleteProvider(id)
  }, [deleteProvider])

  const handleActivate = useCallback(async (id: string) => {
    await activateProvider(id)
  }, [activateProvider])

  const handleDeactivateAll = useCallback(async () => {
    await deactivateAllProviders()
  }, [deactivateAllProviders])

  const activeProvider = providers.find((p) => p.is_active === 1)

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Providers</h2>
          <p className="text-sm text-muted-foreground">
            Configure third-party Anthropic-compatible API providers
          </p>
        </div>
        <Button size="sm" onClick={handleAdd}>
          <Plus className="size-4" />
          Add Provider
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-3">
            <Server className="size-4 text-muted-foreground" />
            <div>
              <span className="text-sm font-medium">Claude Code (Default)</span>
              <p className="text-xs text-muted-foreground">Uses system environment / Claude CLI auth</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className={`h-7 text-xs ${!activeProvider ? 'border-green-500/40 text-green-600 hover:bg-green-50 hover:text-green-600 dark:text-green-400 dark:hover:bg-green-950' : ''}`}
            onClick={() => { if (activeProvider) handleDeactivateAll() }}
          >
            {!activeProvider ? 'Connected' : 'Connect'} {!activeProvider && <Check className="size-3.5" />}
          </Button>
        </div>

        {providers.map((p) => (
          <ProviderRow
            key={p.id}
            provider={p}
            onEdit={() => handleEdit(p)}
            onDelete={() => handleDelete(p.id)}
            onActivate={() => handleActivate(p.id)}
          />
        ))}

        {providers.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">No third-party providers configured</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Click "Add Provider" to connect a third-party API
            </p>
          </div>
        )}
      </div>

      <ProviderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editProvider={editingProvider}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  )
}
