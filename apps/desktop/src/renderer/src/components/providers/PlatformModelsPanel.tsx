import { useCallback, useMemo, useState } from 'react'
import {
  ArrowRight,
  AudioLines,
  Brain,
  Check,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Mic,
  RefreshCw,
  Search,
  Trash2,
  Type,
  Video,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ModelIcon, modelMappings } from '@lobehub/icons'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Switch } from '@superone/ui/components/ui/switch'
import type { CapabilityTask, DiscoveredOpenAiModel } from '@superone/shared/agent-types'
import {
  buildCatalogModelIndex,
  catalogProviderIdFor,
  endpointServes,
  isCustomPlatform,
  mergeModelMapping,
  normalizeModelId,
  resolveEndpointModels,
  type Credential,
  type EndpointModel,
  type Plan,
  type Platform,
  type ServiceEndpoint,
} from '@superone/shared/platform-registry'
import type { CatalogModality, CatalogModel, CatalogProvider } from '@superone/shared/model-catalog-types'
import { MODEL_TASK_ORDER, modelTasks } from '@superone/shared/model-tasks'
import { useModelCatalog } from '@/hooks/useModelCatalog'
import { useSettingsStore } from '@/stores/settings'
import { stripOneM } from '@/lib/model-id'
import { ProviderLabel } from '../ProviderLabel'
import {
  AddCustomModelPopover,
  listCustomModels,
  planSupportedTasks,
  removeCustomModel,
  upsertCustomModel,
  type CustomModel,
} from './custom-models'
import { excludeDiscoveredIds } from './discovery-apply'
import { useModelDiscovery } from './useModelDiscovery'

type Tab = 'all' | CapabilityTask

const MODALITY_LABEL: Record<CatalogModality, string> = {
  text: 'Text',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  pdf: 'PDF',
}

const MODALITY_ICON: Record<CatalogModality, LucideIcon> = {
  text: Type,
  image: ImageIcon,
  audio: AudioLines,
  video: Video,
  pdf: FileText,
}

function ModalityIcons({ mods }: { mods: CatalogModality[] }) {
  if (mods.length === 0) return <span className="text-muted-foreground/50">—</span>
  return (
    <span className="flex items-center gap-0.5">
      {mods.map((x) => {
        const Icon = MODALITY_ICON[x]
        return (
          <span key={x} title={MODALITY_LABEL[x]} className="flex">
            <Icon className="size-3.5" />
          </span>
        )
      })}
    </span>
  )
}

const TASK_ICON: Record<CapabilityTask, LucideIcon> = {
  chat: MessageSquare,
  image: ImageIcon,
  video: Video,
  tts: AudioLines,
  asr: Mic,
}

function formatContext(tokens?: number): string {
  if (!tokens) return ''
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
  return String(tokens)
}

const CATALOG_ID_ALIAS: Record<string, string> = {
  claude: 'anthropic',
  chatgpt: 'openai',
  zhipu: 'zhipuai',
  zai: 'zhipuai',
  kimi: 'moonshotai',
  moonshot: 'moonshotai',
  bailian: 'alibaba',
  bedrock: 'amazon-bedrock',
  siliconcloud: 'siliconflow',
  xiaomimimo: 'xiaomi',
  gemini: 'google',
  vertexai: 'google',
}

function hasModelIcon(id: string): boolean {
  const m = id.toLowerCase()
  return modelMappings.some((entry) => entry.keywords.some((k) => new RegExp(k, 'i').test(m)))
}

function matchCatalogProvider(providers: CatalogProvider[], platform: Platform, plan: Plan): CatalogProvider | null {
  const catalogId = catalogProviderIdFor(platform, plan)
  if (catalogId) {
    const direct = providers.find((p) => p.id === catalogId)
    if (direct) return direct
  }
  const target = CATALOG_ID_ALIAS[platform.brand] ?? platform.brand
  return (
    providers.find((p) => p.id === target) ??
    providers.find((p) => p.id.includes(target) || p.name.toLowerCase().includes(target)) ??
    null
  )
}

function TabButton({ active, onClick, icon: Icon, label, count }: { active: boolean; onClick: () => void; icon: LucideIcon; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-xs transition-colors ${active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
    >
      <Icon className="size-3.5" />
      {label}
      <span className={active ? 'text-primary/70' : 'text-muted-foreground/70'}>({count})</span>
    </button>
  )
}

function CapBadge({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <span title={title} className="flex size-5 items-center justify-center rounded bg-muted text-muted-foreground">
      <Icon className="size-3" />
    </span>
  )
}

function ModelIdBadge({ id }: { id: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <span className="flex min-w-0 shrink items-center gap-1">
      <button
        type="button"
        title={id}
        onClick={() => {
          void window.app.clipboardWrite(id)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
        className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {id}
      </button>
      {copied && (
        <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-green-500">
          {t('resources.providerDialog.models.copied')}
          <Check className="size-3" />
        </span>
      )}
    </span>
  )
}

type ModelRow = { m: CatalogModel; iconMatched: boolean; endpoints: ServiceEndpoint[]; enabled: boolean; locked: boolean }

/** Every plan endpoint that serves any of a model's tasks — its enable state is stored on each. */
function endpointsForTasks(plan: Plan, tasks: CapabilityTask[]): ServiceEndpoint[] {
  return plan.endpoints.filter((e) => tasks.some((t) => endpointServes(e, t)))
}

export function PlatformModelsPanel({
  platform,
  plan,
  selectedKeyId = '',
}: {
  platform: Platform
  plan: Plan
  selectedKeyId?: string
}) {
  const { t } = useTranslation()
  const { catalog, loading, refreshing, refresh } = useModelCatalog()
  const credentials = useSettingsStore((s) => s.credentials)
  const updateCredential = useSettingsStore((s) => s.updateCredential)
  const updateCustomPlatform = useSettingsStore((s) => s.updateCustomPlatform)
  const isCustom = isCustomPlatform(platform)

  const planCreds = useMemo(
    () => credentials.filter((c) => c.platformId === platform.id && c.planId === plan.id),
    [credentials, platform.id, plan.id],
  )
  const selectedCred: Credential | undefined = planCreds.find((c) => c.id === selectedKeyId) ?? planCreds[0]

  const catProvider = useMemo(
    () => (catalog ? matchCatalogProvider(catalog.providers, platform, plan) : null),
    [catalog, platform, plan],
  )

  // Bare-id lookup so custom/auto-discovered models can show the same catalog info (pricing,
  // context window, modalities, reasoning/tool support) as catalog-matched models — even though
  // they weren't sourced from `catProvider`.
  const catalogModelIndex = useMemo(() => (catalog ? buildCatalogModelIndex(catalog) : null), [catalog])

  const {
    endpoint: discoveryEp,
    discovered,
    state: discoverState,
    discover,
    enableModels,
  } = useModelDiscovery({ platform, plan, credential: selectedCred, updateCredential, updateCustomPlatform })

  const fetchBusy = isCustom ? discoverState.status === 'loading' : refreshing
  const canFetch = isCustom ? !!discoveryEp && !!selectedCred : true
  const handleFetch = useCallback(() => {
    if (isCustom) {
      if (canFetch) void discover()
      return
    }
    void refresh()
  }, [isCustom, canFetch, discover, refresh])

  // Only models this plan's endpoints actually serve are shown — a model no endpoint serves
  // (e.g. a chat model on the image-only Gemini plan) isn't configurable here.
  const annotated = useMemo(
    () =>
      (catProvider?.models ?? [])
        .map((m) => ({ m, endpoints: endpointsForTasks(plan, modelTasks(m)), iconMatched: hasModelIcon(m.id) }))
        .filter((x) => x.endpoints.length > 0)
        .sort((a, b) => (b.m.releaseDate ?? '').localeCompare(a.m.releaseDate ?? '')),
    [catProvider, plan],
  )

  // Resolved model pool per endpoint — the "all on" baseline the enabled subset is measured against.
  const endpointPools = useMemo(() => {
    const map = new Map<string, EndpointModel[]>()
    for (const e of plan.endpoints) map.set(e.id, resolveEndpointModels(platform, plan, e, catalog ?? undefined))
    return map
  }, [platform, plan, catalog])

  // Model ids referenced by each endpoint's effective model mapping (defaults ← credential override).
  // These are always-on and cannot be disabled — the harness routes to them.
  const mappedByEndpoint = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const e of plan.endpoints) {
      const mapping = mergeModelMapping(e.defaults?.modelMapping, selectedCred?.overrides?.[e.id]?.modelMapping)
      const ids = new Set<string>()
      // Mapping ids may carry the `[1m]` context suffix (e.g. glm-5.2[1m]); catalog ids don't — match on the base id.
      for (const slot of Object.values(mapping)) if (slot?.id) ids.add(stripOneM(slot.id))
      map.set(e.id, ids)
    }
    return map
  }, [plan, selectedCred])

  // Enabling is opt-in: a model is off unless the user explicitly enabled it, or the mapping locks it on.
  const modelState = useCallback(
    (endpoints: ServiceEndpoint[], modelId: string): { enabled: boolean; locked: boolean } => {
      const locked = endpoints.some((ep) => mappedByEndpoint.get(ep.id)?.has(modelId))
      if (locked) return { enabled: true, locked: true }
      const enabled = endpoints.some((ep) => (selectedCred?.overrides?.[ep.id]?.models ?? []).some((x) => x.id === modelId))
      return { enabled, locked: false }
    },
    [mappedByEndpoint, selectedCred],
  )

  const toggle = useCallback(
    (endpoints: ServiceEndpoint[], model: EndpointModel, next: boolean) => {
      if (!selectedCred || endpoints.length === 0) return
      const overrides = { ...selectedCred.overrides }
      for (const ep of endpoints) {
        const pool = endpointPools.get(ep.id) ?? []
        const existing = overrides[ep.id]?.models ?? []
        const enabledIds = new Set(existing.map((m) => m.id))
        if (next) enabledIds.add(model.id)
        else enabledIds.delete(model.id)
        // Preserve user-added models (not in the catalog pool) — only the catalog subset is re-derived.
        const custom = existing.filter((m) => !pool.some((p) => p.id === m.id))
        const nextModels = [...pool.filter((m) => enabledIds.has(m.id)), ...custom]
        const nextOverride = { ...overrides[ep.id] }
        if (nextModels.length > 0) nextOverride.models = nextModels
        else delete nextOverride.models
        if (Object.keys(nextOverride).length === 0) delete overrides[ep.id]
        else overrides[ep.id] = nextOverride
      }
      void updateCredential(selectedCred.id, { overrides })
    },
    [selectedCred, endpointPools, updateCredential],
  )

  // A model id belongs to the catalog if the endpoint's resolved pool contains it; anything else in
  // the credential's overrides is a user-added custom model.
  const isCatalogModel = useCallback(
    (endpointId: string, modelId: string) => (endpointPools.get(endpointId) ?? []).some((m) => m.id === modelId),
    [endpointPools],
  )
  const customModels = useMemo(
    () => excludeDiscoveredIds(listCustomModels(selectedCred?.overrides, isCatalogModel), discovered),
    [selectedCred, isCatalogModel, discovered],
  )
  const supportedTasks = useMemo(() => planSupportedTasks(plan), [plan])

  const addCustom = useCallback(
    (model: CustomModel) => {
      if (!selectedCred) return
      void updateCredential(selectedCred.id, { overrides: upsertCustomModel(selectedCred.overrides, plan, model) })
    },
    [selectedCred, plan, updateCredential],
  )
  const removeCustom = useCallback(
    (id: string) => {
      if (!selectedCred) return
      void updateCredential(selectedCred.id, { overrides: removeCustomModel(selectedCred.overrides, id) })
    },
    [selectedCred, updateCredential],
  )

  // Enabling may synthesize/widen family endpoints (openai/anthropic/google) before writing. Disabling
  // drops the model id from every override slot regardless of family.
  const toggleDiscovered = useCallback(
    (model: DiscoveredOpenAiModel, next: boolean) => {
      if (next) void enableModels([model])
      else removeCustom(model.id)
    },
    [enableModels, removeCustom],
  )

  const taskCounts = useMemo(() => {
    const counts = new Map<CapabilityTask, number>()
    for (const { m } of annotated) for (const tk of modelTasks(m)) counts.set(tk, (counts.get(tk) ?? 0) + 1)
    for (const cm of customModels) for (const tk of cm.tasks) counts.set(tk, (counts.get(tk) ?? 0) + 1)
    for (const d of discovered) for (const tk of d.tasks) counts.set(tk, (counts.get(tk) ?? 0) + 1)
    return counts
  }, [annotated, customModels, discovered])
  const totalCount = annotated.length + customModels.length + discovered.length
  const presentTasks = MODEL_TASK_ORDER.filter((tk) => taskCounts.has(tk))

  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const activeTab: Tab = tab !== 'all' && !taskCounts.has(tab) ? 'all' : tab

  const rows = useMemo<ModelRow[]>(() => {
    const q = query.trim().toLowerCase()
    return annotated
      .filter(({ m }) => {
        const tasks = modelTasks(m)
        if (activeTab !== 'all' && !tasks.includes(activeTab)) return false
        if (q && !m.id.toLowerCase().includes(q) && !m.name.toLowerCase().includes(q)) return false
        return true
      })
      .map(({ m, endpoints, iconMatched }) => ({ m, iconMatched, endpoints, ...modelState(endpoints, m.id) }))
  }, [annotated, activeTab, query, modelState])

  const enabledRows = useMemo(() => rows.filter((r) => r.enabled), [rows])
  const disabledRows = useMemo(() => rows.filter((r) => !r.enabled), [rows])

  const customRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return customModels.filter((cm) => {
      if (activeTab !== 'all' && !cm.tasks.includes(activeTab)) return false
      if (q && !cm.id.toLowerCase().includes(q) && !(cm.name ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [customModels, activeTab, query])
  const discoveredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return discovered.filter((d) => {
      if (activeTab !== 'all' && !d.tasks.includes(activeTab)) return false
      if (q && !d.id.toLowerCase().includes(q) && !(d.name ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [discovered, activeTab, query])
  const existingIds = useMemo(
    () => [...annotated.map((a) => a.m.id), ...customModels.map((c) => c.id), ...discovered.map((d) => d.id)],
    [annotated, customModels, discovered],
  )

  const subtitle = (m: CatalogModel): string => {
    const parts: string[] = []
    if (m.releaseDate) parts.push(t('resources.providerDialog.models.released', { date: m.releaseDate }))
    if (m.cost) {
      parts.push(`${t('resources.providerDialog.models.priceIn')} $${m.cost.input}/M`)
      parts.push(`${t('resources.providerDialog.models.priceOut')} $${m.cost.output}/M`)
    }
    return parts.join(' · ')
  }

  // Modality/tool/reasoning/context badges — shared between catalog-matched rows and custom/
  // discovered rows that happen to resolve to a catalog entry via `catalogModelIndex`.
  const catalogExtras = (m: CatalogModel) => (
    <>
      <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-1 text-muted-foreground">
        <ModalityIcons mods={m.inputModalities} />
        <ArrowRight className="size-3 opacity-50" />
        <ModalityIcons mods={m.outputModalities} />
      </span>
      {m.toolCall && <CapBadge icon={Wrench} title={t('resources.providerDialog.models.tools')} />}
      {m.reasoning && <CapBadge icon={Brain} title={t('resources.providerDialog.models.reasoning')} />}
      {m.contextWindow ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{formatContext(m.contextWindow)}</span> : null}
    </>
  )

  const renderRow = ({ m, iconMatched, endpoints, enabled, locked }: ModelRow) => (
    <div key={m.id} className="flex items-center gap-3 px-3 py-2.5">
      <div className="flex size-7 shrink-0 items-center justify-center">
        {iconMatched
          ? <ModelIcon model={m.id} type="color" size={26} />
          : <ProviderLabel brandKey={platform.brand} iconOnly size={26} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`truncate text-sm font-medium ${selectedCred && !enabled ? 'text-muted-foreground' : ''}`}>{m.name}</span>
          <ModelIdBadge id={m.id} />
          {m.status && <span className="shrink-0 rounded bg-amber-500/10 px-1 text-[9px] text-amber-600 dark:text-amber-400">{m.status}</span>}
        </div>
        {subtitle(m) && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle(m)}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {catalogExtras(m)}
        {selectedCred && (
          <span title={locked ? t('resources.providerDialog.models.lockedHint') : undefined} className="flex">
            <Switch
              checked={enabled}
              disabled={locked || endpoints.length === 0}
              onCheckedChange={(v) => toggle(endpoints, { id: m.id, name: m.name }, v)}
            />
          </span>
        )}
      </div>
    </div>
  )

  const renderCustomRow = (cm: CustomModel) => {
    const catModel = catalogModelIndex?.get(normalizeModelId(cm.id))
    return (
      <div key={cm.id} className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center">
          {hasModelIcon(cm.id)
            ? <ModelIcon model={cm.id} type="color" size={26} />
            : <ProviderLabel brandKey={platform.brand} iconOnly size={26} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{cm.name || cm.id}</span>
            <ModelIdBadge id={cm.id} />
          </div>
          {catModel && subtitle(catModel) && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle(catModel)}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {catModel && catalogExtras(catModel)}
          <span className="flex items-center gap-1">
            {cm.tasks.map((tk) => (
              <CapBadge key={tk} icon={TASK_ICON[tk]} title={t(`resources.providerDialog.models.${tk}`)} />
            ))}
          </span>
          <IconButton
            size="sm"
            variant="destructive"
            tooltip={t('resources.providerDialog.models.deleteCustom')}
            onClick={() => removeCustom(cm.id)}
          >
            <Trash2 />
          </IconButton>
        </div>
      </div>
    )
  }

  const renderDiscoveredRow = (d: DiscoveredOpenAiModel) => {
    const endpoints = endpointsForTasks(plan, d.tasks)
    const { enabled, locked } = modelState(endpoints, d.id)
    const catModel = catalogModelIndex?.get(normalizeModelId(d.id))
    return (
      <div key={d.id} className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center">
          {hasModelIcon(d.id)
            ? <ModelIcon model={d.id} type="color" size={26} />
            : <ProviderLabel brandKey={platform.brand} iconOnly size={26} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`truncate text-sm font-medium ${!enabled ? 'text-muted-foreground' : ''}`}>{d.name || d.id}</span>
            <ModelIdBadge id={d.id} />
          </div>
          {catModel && subtitle(catModel) && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle(catModel)}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {catModel && catalogExtras(catModel)}
          <span className="flex items-center gap-1">
            {d.tasks.map((tk) => (
              <CapBadge key={tk} icon={TASK_ICON[tk]} title={t(`resources.providerDialog.models.${tk}`)} />
            ))}
          </span>
          <span title={locked ? t('resources.providerDialog.models.lockedHint') : undefined} className="flex">
            <Switch checked={enabled} disabled={locked} onCheckedChange={(v) => toggleDiscovered(d, v)} />
          </span>
        </div>
      </div>
    )
  }

  const groupHeader = (label: string, count: number) => (
    <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-background/95 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground backdrop-blur">
      {label}
      <span className="text-muted-foreground/70">({count})</span>
    </div>
  )

  const header = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold">{t('resources.providerDialog.models.title')}</span>
        <span className="text-xs text-muted-foreground">{t('resources.providerDialog.models.count', { count: totalCount })}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-40 rounded-md border border-border bg-background py-1 pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('resources.providerDialog.models.search')}
          />
        </div>
        {selectedCred && supportedTasks.length > 0 && (
          <AddCustomModelPopover supportedTasks={supportedTasks} existingIds={existingIds} onAdd={addCustom} />
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={handleFetch}
          disabled={!canFetch || fetchBusy}
        >
          {fetchBusy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {t('resources.providerDialog.models.refresh')}
        </Button>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> {t('resources.providerDialog.fetchingModels')}
        </div>
      </div>
    )
  }

  const showList = !!catProvider || totalCount > 0

  return (
    <div className="flex flex-col gap-3">
      {header}

      {discoverState.status === 'error' && (
        <p className="text-xs text-destructive">{t('resources.providerDialog.models.discoverError', { message: discoverState.message })}</p>
      )}
      {discoverState.status === 'done' && discovered.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('resources.providerDialog.models.discoverEmpty')}</p>
      )}
      {discoverState.status === 'done' && discoverState.truncated && (
        <p className="text-xs text-muted-foreground">{t('resources.providerDialog.models.discoverTruncated')}</p>
      )}

      {!catProvider && customModels.length === 0 && discovered.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('resources.providerDialog.models.noEntry')}</p>
      )}

      {showList && (
        <>
          <div className="flex items-center gap-1 border-b border-border">
            <TabButton active={activeTab === 'all'} onClick={() => setTab('all')} icon={LayoutGrid} label={t('resources.providerDialog.models.all')} count={totalCount} />
            {presentTasks.map((tk) => (
              <TabButton key={tk} active={activeTab === tk} onClick={() => setTab(tk)} icon={TASK_ICON[tk]} label={t(`resources.providerDialog.models.${tk}`)} count={taskCounts.get(tk) ?? 0} />
            ))}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {rows.length === 0 && customRows.length === 0 && discoveredRows.length === 0 && (
              <p className="p-4 text-xs text-muted-foreground">{t('resources.providerDialog.models.empty')}</p>
            )}
            {customRows.length > 0 && (
              <>
                {groupHeader(t('resources.providerDialog.models.customGroup'), customRows.length)}
                {customRows.map(renderCustomRow)}
              </>
            )}
            {discoveredRows.length > 0 && (
              <>
                <div className="flex items-center justify-between gap-1.5 bg-background/95 px-3 py-1.5 backdrop-blur">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {t('resources.providerDialog.models.discoveredGroup')} <span className="text-muted-foreground/70">({discoveredRows.length})</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px]"
                    onClick={() => void enableModels(discoveredRows.filter((d) => !modelState(endpointsForTasks(plan, d.tasks), d.id).enabled))}
                  >
                    {t('resources.providerDialog.models.enableAllDiscovered')}
                  </Button>
                </div>
                {discoveredRows.map(renderDiscoveredRow)}
              </>
            )}
            {selectedCred ? (
              <>
                {enabledRows.length > 0 && groupHeader(t('resources.providerDialog.models.enabledGroup'), enabledRows.length)}
                {enabledRows.map(renderRow)}
                {disabledRows.length > 0 && groupHeader(t('resources.providerDialog.models.disabledGroup'), disabledRows.length)}
                {disabledRows.map(renderRow)}
              </>
            ) : (
              rows.map(renderRow)
            )}
          </div>
        </>
      )}
    </div>
  )
}
