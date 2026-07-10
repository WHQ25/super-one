import { useCallback, useMemo, useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { ModelIcon } from '@lobehub/icons'
import { useTranslation } from 'react-i18next'
import { Input } from '@superone/ui/components/ui/input'
import { cn } from '@superone/ui/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import {
  MODEL_BUCKETS,
  type ModelBucket,
  type ProviderModelEnv,
  type ProviderModelSlot,
} from '@superone/shared/agent-types'
import {
  catalogProviderIdFor,
  defaultOverridesForPlan,
  resolveEndpointModels,
  type Credential,
  type EndpointModel,
  type EndpointOverride,
  type Platform,
  type Plan,
  type ServiceEndpoint,
} from '@superone/shared/platform-registry'

import { useModelCatalog } from '@/hooks/useModelCatalog'
import { useSettingsStore } from '@/stores/settings'
import { ONE_M_SUFFIX, stripOneM } from '@/lib/model-id'

const RESERVED_ENV_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
])

function parseEnvString(text: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = []
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    let trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('export ')) trimmed = trimmed.slice(7).trim()
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key && !seen.has(key)) {
      seen.add(key)
      out.push({ key, value })
    }
  }
  return out
}

// --- env editor (Record<string,string>) --------------------------------------

export function EnvEditor({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const { t } = useTranslation()
  const [pairs, setPairs] = useState<Array<{ key: string; value: string }>>(() =>
    Object.entries(value).map(([key, v]) => ({ key, value: v })),
  )
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  const sync = (next: Array<{ key: string; value: string }>) => {
    setPairs(next)
    const record: Record<string, string> = {}
    for (const p of next) if (p.key && !RESERVED_ENV_KEYS.has(p.key)) record[p.key] = p.value
    onChange(record)
  }

  const applyPaste = () => {
    const parsed = parseEnvString(pasteText).filter((p) => !RESERVED_ENV_KEYS.has(p.key))
    const existing = new Set(pairs.map((p) => p.key).filter(Boolean))
    sync([...pairs, ...parsed.filter((p) => !existing.has(p.key))])
    setPasteText('')
    setPasteOpen(false)
  }

  return (
    <div className="flex flex-col gap-1.5">
      {pairs.map((pair, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            className="w-[40%] rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            value={pair.key}
            onChange={(e) => sync(pairs.map((p, j) => (j === i ? { ...p, key: e.target.value } : p)))}
            placeholder="KEY"
          />
          <input
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            value={pair.value}
            onChange={(e) => sync(pairs.map((p, j) => (j === i ? { ...p, value: e.target.value } : p)))}
            placeholder="value"
          />
          <button
            type="button"
            onClick={() => sync(pairs.filter((_, j) => j !== i))}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPairs((prev) => [...prev, { key: '', value: '' }])}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3" /> {t('resources.providerDialog.addVariable')}
        </button>
        <button
          type="button"
          onClick={() => setPasteOpen((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3" /> {t('resources.providerDialog.pasteEnv')}
        </button>
      </div>
      {pasteOpen && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border p-2">
          <textarea
            className="min-h-[72px] rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="KEY1=value1&#10;export KEY2=value2"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => { setPasteOpen(false); setPasteText('') }}
              className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={applyPaste}
              className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground hover:bg-primary/90"
            >
              {t('resources.providerDialog.applyPaste')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// --- model mapping editor (ProviderModelEnv) ---------------------------------

function ModelMappingEditor({
  models,
  oneMillionIds,
  value,
  onChange,
}: {
  models: EndpointModel[]
  oneMillionIds: Set<string>
  value: ProviderModelEnv
  onChange: (v: ProviderModelEnv) => void
}) {
  const { t } = useTranslation()
  const label: Record<ModelBucket, string> = {
    default: t('resources.providerDialog.bucketDefault'),
    opus: 'Opus',
    sonnet: 'Sonnet',
    haiku: 'Haiku',
    subagent: t('resources.providerDialog.bucketSubagent'),
  }

  const setSlot = (bucket: ModelBucket, slot: ProviderModelSlot | null) => {
    const next: ProviderModelEnv = { ...value }
    if (slot) next[bucket] = slot
    else delete next[bucket]
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-1.5">
      {MODEL_BUCKETS.map((bucket) => (
        <div key={bucket} className="flex items-center gap-1.5">
          <span className="w-16 shrink-0 text-xs text-muted-foreground">{label[bucket]}</span>
          <ModelSlotSelect models={models} oneMillionIds={oneMillionIds} value={value[bucket]} onChange={(s) => setSlot(bucket, s)} />
        </div>
      ))}
    </div>
  )
}

/** Manual model-mapping editor: type a model id + display name per bucket. For custom providers with no catalog. */
export function ModelEnvEditor({ value, onChange }: { value: ProviderModelEnv; onChange: (v: ProviderModelEnv) => void }) {
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

function ModelSlotSelect({
  models,
  oneMillionIds,
  value,
  onChange,
}: {
  models: EndpointModel[]
  oneMillionIds: Set<string>
  value: ProviderModelSlot | undefined
  onChange: (slot: ProviderModelSlot | null) => void
}) {
  const { t } = useTranslation()
  const baseId = value ? stripOneM(value.id) : undefined
  const has1m = !!value && value.id.endsWith(ONE_M_SUFFIX)
  const supports1m = !!baseId && oneMillionIds.has(baseId)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-xs transition-colors hover:bg-muted">
            {baseId ? (
              <>
                <ModelIcon model={baseId} size={14} className="shrink-0" />
                <span className="truncate">{value?.name ?? baseId}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{t('resources.providers.selectModel')}</span>
            )}
            <ChevronDown className="ml-auto size-3 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
          <DropdownMenuItem onClick={() => onChange(null)} className="text-muted-foreground">
            {t('resources.providers.modelNone')}
          </DropdownMenuItem>
          {models.map((m) => (
            <DropdownMenuItem key={m.id} onClick={() => onChange({ id: m.id, name: m.name })} className="flex items-center gap-1.5">
              <ModelIcon model={m.id} size={16} className="shrink-0" />
              <span className="truncate">{m.name ?? m.id}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {supports1m && baseId && (
        <button
          type="button"
          title={t('resources.providers.oneMillionHint')}
          onClick={() => onChange({ id: has1m ? baseId : baseId + ONE_M_SUFFIX, name: value?.name })}
          className={cn(
            'shrink-0 rounded-md border px-1.5 py-1.5 text-[10px] font-semibold transition-colors',
            has1m ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          1M
        </button>
      )}
    </div>
  )
}

// --- per-endpoint override config --------------------------------------------

function isEmptyOverride(o: EndpointOverride): boolean {
  return !o.baseUrl && !o.models?.length && !o.extraEnv && !o.modelMapping
}

function pruneOverride(o: EndpointOverride): EndpointOverride {
  const out: EndpointOverride = {}
  if (o.baseUrl?.trim()) out.baseUrl = o.baseUrl.trim()
  const models = o.models?.filter((m) => m.id.trim())
  if (models && models.length > 0) out.models = models
  if (o.extraEnv && Object.keys(o.extraEnv).length > 0) out.extraEnv = o.extraEnv
  if (o.modelMapping && Object.keys(o.modelMapping).length > 0) out.modelMapping = o.modelMapping
  return out
}

function EndpointOverrideFields({
  platform,
  plan,
  endpoint,
  showLabel,
  value,
  onChange,
}: {
  platform: Platform
  plan: Plan
  endpoint: ServiceEndpoint
  showLabel: boolean
  value: EndpointOverride
  onChange: (v: EndpointOverride) => void
}) {
  const { t } = useTranslation()
  const { catalog } = useModelCatalog()
  const suggestions = useMemo(
    () => resolveEndpointModels(platform, plan, endpoint, catalog ?? undefined),
    [platform, plan, endpoint, catalog],
  )
  // Catalog ids whose context window is >=1M — eligible for the `[1m]` long-context toggle.
  const oneMillionIds = useMemo(() => {
    const ids = new Set<string>()
    const provider = catalog?.providers.find((p) => p.id === catalogProviderIdFor(platform, plan))
    for (const m of provider?.models ?? []) if ((m.contextWindow ?? 0) >= 1_000_000) ids.add(m.id)
    return ids
  }, [catalog, platform, plan])
  // The first-party Anthropic API uses native Claude models on the real endpoint —
  // model remapping and a compatible-endpoint override make no sense there.
  const isFirstPartyAnthropic = platform.id === 'anthropic'
  const isAnthropic = endpoint.protocol === 'anthropic-messages'

  return (
    <div className="flex flex-col gap-3">
      {showLabel && (
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{endpoint.protocol}</span>
      )}

      {!isFirstPartyAnthropic && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{isAnthropic ? t('resources.providers.claudeBaseUrl') : t('resources.providers.baseUrl')}</span>
          <Input
            value={value.baseUrl ?? ''}
            onChange={(e) => onChange({ ...value, baseUrl: e.target.value })}
            placeholder={endpoint.baseUrl}
          />
        </label>
      )}

      {isAnthropic && !isFirstPartyAnthropic && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.modelMapping')}</span>
          <ModelMappingEditor
            models={suggestions}
            oneMillionIds={oneMillionIds}
            value={value.modelMapping ?? {}}
            onChange={(v) => onChange({ ...value, modelMapping: v })}
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.environmentVariables')}</span>
        <EnvEditor value={value.extraEnv ?? {}} onChange={(v) => onChange({ ...value, extraEnv: v })} />
      </div>
    </div>
  )
}

/** Prune a full overrides map, dropping empty per-endpoint overrides. */
export function pruneOverrides(value: Record<string, EndpointOverride>): Record<string, EndpointOverride> {
  const out: Record<string, EndpointOverride> = {}
  for (const [id, o] of Object.entries(value)) {
    const pruned = pruneOverride(o)
    if (!isEmptyOverride(pruned)) out[id] = pruned
  }
  return out
}

/** Controlled editor for a credential's per-endpoint overrides (no store writes). */
export function OverridesEditor({
  platform,
  plan,
  value,
  onChange,
}: {
  platform: Platform
  plan: Plan
  value: Record<string, EndpointOverride>
  onChange: (v: Record<string, EndpointOverride>) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {plan.endpoints.map((endpoint) => (
        <EndpointOverrideFields
          key={endpoint.id}
          platform={platform}
          plan={plan}
          endpoint={endpoint}
          showLabel={plan.endpoints.length > 1}
          value={value[endpoint.id] ?? {}}
          onChange={(next) => onChange({ ...value, [endpoint.id]: next })}
        />
      ))}
    </div>
  )
}

export function CredentialConfig({ platform, plan, credential }: { platform: Platform; plan: Plan; credential: Credential }) {
  const updateCredential = useSettingsStore((s) => s.updateCredential)
  const [draft, setDraft] = useState<Record<string, EndpointOverride>>(() =>
    credential.overrides && Object.keys(credential.overrides).length > 0
      ? credential.overrides
      : defaultOverridesForPlan(plan),
  )

  const commit = useCallback(() => {
    void updateCredential(credential.id, { overrides: pruneOverrides(draft) })
  }, [draft, credential.id, updateCredential])

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-muted/30 p-3" onBlur={commit}>
      <OverridesEditor platform={platform} plan={plan} value={draft} onChange={setDraft} />
    </div>
  )
}
