import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { ModelIcon } from '@lobehub/icons'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
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
import type { EndpointModel } from '@superone/shared/platform-registry'
import { ONE_M_SUFFIX, stripOneM } from '@/lib/model-id'

type MappingMode = 'pick' | 'manual'

function useBucketLabels(): Record<ModelBucket, string> {
  const { t } = useTranslation()
  return {
    default: t('resources.providerDialog.bucketDefault'),
    opus: 'Opus',
    sonnet: 'Sonnet',
    haiku: 'Haiku',
    subagent: t('resources.providerDialog.bucketSubagent'),
  }
}

/**
 * Open on the list only when every mapped id is on it; a mapping already holding an id the list
 * lacks opens in manual mode, or picking would be the only way to see that id.
 */
function initialMode(models: EndpointModel[], value: ProviderModelEnv): MappingMode {
  const ids = new Set(models.map((m) => m.id))
  return Object.values(value).every((slot) => !slot?.id || ids.has(stripOneM(slot.id))) ? 'pick' : 'manual'
}

/**
 * Model mapping with a pick/manual switch. Picking offers the endpoint's model list; manual entry
 * takes any id and display name — the only way to map a model the list does not know yet. With no
 * list there is nothing to pick from, so the field is manual only.
 */
export function ModelMappingField({
  label,
  models,
  oneMillionIds,
  value,
  onChange,
}: {
  label: string
  models: EndpointModel[]
  oneMillionIds: Set<string>
  value: ProviderModelEnv
  onChange: (v: ProviderModelEnv) => void
}) {
  const { t } = useTranslation()
  const canPick = models.length > 0
  // The list arrives with the async catalog, so the opening mode is settled the first time it is
  // non-empty and then left alone — re-deriving it would flip modes under the user's typing.
  const [mode, setMode] = useState<MappingMode | null>(() => (canPick ? initialMode(models, value) : null))
  if (mode === null && canPick) setMode(initialMode(models, value))
  const effective: MappingMode = canPick ? (mode ?? 'manual') : 'manual'
  const modes: Array<{ value: MappingMode; label: string }> = [
    { value: 'pick', label: t('resources.providerDialog.modelMappingPick') },
    { value: 'manual', label: t('resources.providerDialog.modelMappingManual') },
  ]

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {canPick && (
          <Tabs value={effective} onValueChange={(v) => setMode(v as MappingMode)}>
            <TabsList aria-label={label}>
              {modes.map((m) => (
                <TabsTrigger key={m.value} value={m.value}>
                  {m.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </div>
      {effective === 'pick' ? (
        <ModelMappingEditor models={models} oneMillionIds={oneMillionIds} value={value} onChange={onChange} />
      ) : (
        <ModelEnvEditor value={value} onChange={onChange} />
      )}
    </div>
  )
}

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
  const label = useBucketLabels()

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

/** Manual model-mapping editor: type a model id + display name per bucket. */
export function ModelEnvEditor({ value, onChange }: { value: ProviderModelEnv; onChange: (v: ProviderModelEnv) => void }) {
  const { t } = useTranslation()
  const bucketLabel = useBucketLabels()

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
