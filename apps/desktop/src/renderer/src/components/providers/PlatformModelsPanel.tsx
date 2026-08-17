import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AudioLines,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Mic,
  RefreshCw,
  Search,
  Trash2,
  Video,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import type { CapabilityTask, DiscoveredOpenAiModel } from '@superone/shared/agent-types'
import {
  buildCatalogModelIndex,
  catalogProviderIdFor,
  effectiveEndpoints,
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
import type { CatalogModel, CatalogProvider } from '@superone/shared/model-catalog-types'
import { MODEL_TASK_ORDER, modelTasks } from '@superone/shared/model-tasks'
import { useModelCatalog } from '@/hooks/useModelCatalog'
import { useSettingsStore } from '@/stores/settings'
import { stripOneM } from '@/lib/model-id'
import { CapBadge, ModelsListGroupHeader, ProviderModelRow } from './ProviderModelsList'
import {
  AddCustomModelPopover,
  listCustomModels,
  planSupportedTasks,
  removeCustomModel,
  upsertCustomModel,
  type CustomModel,
} from './custom-models'
import { applyCatalogDisplayNames, excludeDiscoveredIds, patchDiscoveredModel } from './discovery-apply'
import { EditDiscoveredModelPopover } from './EditDiscoveredModelPopover'
import { useModelDiscovery } from './useModelDiscovery'

type Tab = 'all' | CapabilityTask

const TASK_ICON: Record<CapabilityTask, LucideIcon> = {
  chat: MessageSquare,
  image: ImageIcon,
  video: Video,
  tts: AudioLines,
  asr: Mic,
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

type ModelRow = { m: CatalogModel; endpoints: ServiceEndpoint[]; enabled: boolean; locked: boolean }

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

  // Custom keys own their endpoint list; builtin still uses plan.endpoints (+ overrides).
  const liveEndpoints = useMemo(
    () => effectiveEndpoints(platform, plan, selectedCred),
    [platform, plan, selectedCred],
  )
  const livePlan = useMemo(() => ({ ...plan, endpoints: liveEndpoints }), [plan, liveEndpoints])

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
    patchDiscovered,
    replaceDiscovered,
  } = useModelDiscovery({ platform, plan, credential: selectedCred, updateCredential, updateCustomPlatform })

  useEffect(() => {
    if (!catalogModelIndex) return
    const named = applyCatalogDisplayNames(discovered, catalogModelIndex)
    if (named !== discovered) replaceDiscovered(named)
  }, [catalogModelIndex, discovered, replaceDiscovered])

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
        .map((m) => ({ m, endpoints: endpointsForTasks(livePlan, modelTasks(m)) }))
        .filter((x) => x.endpoints.length > 0)
        .sort((a, b) => (b.m.releaseDate ?? '').localeCompare(a.m.releaseDate ?? '')),
    [catProvider, livePlan],
  )

  // Resolved model pool per endpoint — the "all on" baseline the enabled subset is measured against.
  const endpointPools = useMemo(() => {
    const map = new Map<string, EndpointModel[]>()
    for (const e of liveEndpoints) map.set(e.id, resolveEndpointModels(platform, livePlan, e, catalog ?? undefined))
    return map
  }, [platform, livePlan, liveEndpoints, catalog])

  // Model ids referenced by each endpoint's effective model mapping (defaults ← credential override).
  // These are always-on and cannot be disabled — the harness routes to them.
  const mappedByEndpoint = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const e of liveEndpoints) {
      const mapping = mergeModelMapping(e.defaults?.modelMapping, selectedCred?.overrides?.[e.id]?.modelMapping)
      const ids = new Set<string>()
      // Mapping ids may carry the `[1m]` context suffix (e.g. glm-5.2[1m]); catalog ids don't — match on the base id.
      for (const slot of Object.values(mapping)) if (slot?.id) ids.add(stripOneM(slot.id))
      map.set(e.id, ids)
    }
    return map
  }, [liveEndpoints, selectedCred])

  const modelsOnEndpoint = useCallback(
    (epId: string): EndpointModel[] => {
      if (isCustom) {
        return liveEndpoints.find((e) => e.id === epId)?.models ?? []
      }
      return selectedCred?.overrides?.[epId]?.models ?? []
    },
    [isCustom, liveEndpoints, selectedCred],
  )

  // Enabling is opt-in: a model is off unless the user explicitly enabled it, or the mapping locks it on.
  const modelState = useCallback(
    (endpoints: ServiceEndpoint[], modelId: string): { enabled: boolean; locked: boolean } => {
      const locked = endpoints.some((ep) => mappedByEndpoint.get(ep.id)?.has(modelId))
      if (locked) return { enabled: true, locked: true }
      const enabled = endpoints.some((ep) => modelsOnEndpoint(ep.id).some((x) => x.id === modelId))
      return { enabled, locked: false }
    },
    [mappedByEndpoint, modelsOnEndpoint],
  )

  const toggle = useCallback(
    (endpoints: ServiceEndpoint[], model: EndpointModel, next: boolean) => {
      if (!selectedCred || endpoints.length === 0) return
      if (isCustom) {
        const nextEndpoints = liveEndpoints.map((e) => {
          if (!endpoints.some((x) => x.id === e.id)) return e
          const pool = endpointPools.get(e.id) ?? []
          const existing = e.models ?? []
          const enabledIds = new Set(existing.map((m) => m.id))
          if (next) enabledIds.add(model.id)
          else enabledIds.delete(model.id)
          const custom = existing.filter((m) => !pool.some((p) => p.id === m.id))
          const nextModels = [...pool.filter((m) => enabledIds.has(m.id)), ...custom]
          return { ...e, models: nextModels.length > 0 ? nextModels : undefined }
        })
        void updateCredential(selectedCred.id, { endpoints: nextEndpoints })
        return
      }
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
    [selectedCred, endpointPools, updateCredential, isCustom, liveEndpoints],
  )

  // A model id belongs to the catalog if the endpoint's resolved pool contains it; anything else in
  // the credential's overrides is a user-added custom model.
  const isCatalogModel = useCallback(
    (endpointId: string, modelId: string) => {
      // Custom platforms have no models.dev catalog; endpoint.models is the enabled set,
      // not a catalog pool. Treating it as catalog hid every saved model after create.
      if (isCustom) return false
      return (endpointPools.get(endpointId) ?? []).some((m) => m.id === modelId)
    },
    [endpointPools, isCustom],
  )
  const customModels = useMemo(() => {
    if (isCustom) {
      const fakeOverrides: Record<string, { models?: EndpointModel[] }> = {}
      for (const e of liveEndpoints) {
        if (e.models?.length) fakeOverrides[e.id] = { models: e.models }
      }
      return excludeDiscoveredIds(listCustomModels(fakeOverrides, isCatalogModel), discovered)
    }
    return excludeDiscoveredIds(listCustomModels(selectedCred?.overrides, isCatalogModel), discovered)
  }, [isCustom, liveEndpoints, selectedCred, isCatalogModel, discovered])
  const supportedTasks = useMemo(() => planSupportedTasks(livePlan), [livePlan])

  const addCustom = useCallback(
    (model: CustomModel) => {
      if (!selectedCred) return
      if (isCustom) {
        const overrides = upsertCustomModel({}, livePlan, model)
        const nextEndpoints = liveEndpoints.map((e) => {
          const models = overrides[e.id]?.models
          if (!models) return e
          return { ...e, models: [...(e.models ?? []), ...models.filter((m) => !(e.models ?? []).some((x) => x.id === m.id))] }
        })
        void updateCredential(selectedCred.id, { endpoints: nextEndpoints })
        return
      }
      void updateCredential(selectedCred.id, { overrides: upsertCustomModel(selectedCred.overrides, livePlan, model) })
    },
    [selectedCred, livePlan, updateCredential, isCustom, liveEndpoints],
  )
  const removeCustom = useCallback(
    (id: string) => {
      if (!selectedCred) return
      if (isCustom) {
        const nextEndpoints = liveEndpoints.map((e) => ({
          ...e,
          models: e.models?.filter((m) => m.id !== id),
        }))
        void updateCredential(selectedCred.id, { endpoints: nextEndpoints })
        return
      }
      void updateCredential(selectedCred.id, { overrides: removeCustomModel(selectedCred.overrides, id) })
    },
    [selectedCred, updateCredential, isCustom, liveEndpoints],
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

  const editDiscovered = useCallback(
    (model: DiscoveredOpenAiModel) => {
      patchDiscovered(model)
      const enabled = liveEndpoints.some((ep) => modelsOnEndpoint(ep.id).some((m) => m.id === model.id))
      if (enabled) void enableModels([model])
    },
    [patchDiscovered, liveEndpoints, modelsOnEndpoint, enableModels],
  )

  const disableDiscovered = useCallback(
    (models: DiscoveredOpenAiModel[]) => {
      if (!selectedCred || models.length === 0) return
      const ids = new Set(models.map((m) => m.id))
      if (isCustom) {
        const nextEndpoints = liveEndpoints.map((e) => ({
          ...e,
          models: e.models?.filter((m) => !ids.has(m.id)),
        }))
        void updateCredential(selectedCred.id, { endpoints: nextEndpoints })
        return
      }
      let overrides = { ...selectedCred.overrides }
      for (const id of ids) overrides = removeCustomModel(overrides, id)
      void updateCredential(selectedCred.id, { overrides })
    },
    [selectedCred, isCustom, liveEndpoints, updateCredential],
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
      .map(({ m, endpoints }) => ({ m, endpoints, ...modelState(endpoints, m.id) }))
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
  const discoveredBulk = useMemo(() => {
    const unlocked = discoveredRows.filter((d) => !modelState(endpointsForTasks(livePlan, d.tasks), d.id).locked)
    const allOn = unlocked.length > 0 && unlocked.every((d) => modelState(endpointsForTasks(livePlan, d.tasks), d.id).enabled)
    return { unlocked, allOn }
  }, [discoveredRows, livePlan, modelState])
  const existingIds = useMemo(
    () => [...annotated.map((a) => a.m.id), ...customModels.map((c) => c.id), ...discovered.map((d) => d.id)],
    [annotated, customModels, discovered],
  )

  const renderRow = ({ m, endpoints, enabled, locked }: ModelRow) => (
    <ProviderModelRow
      key={m.id}
      id={m.id}
      name={m.name}
      enabled={enabled}
      mutedWhenDisabled={!!selectedCred}
      locked={locked}
      lockedHint={t('resources.providerDialog.models.lockedHint')}
      catalog={m}
      status={m.status}
      providerBrand={platform.brand}
      switchDisabled={endpoints.length === 0}
      onToggle={selectedCred ? (v) => toggle(endpoints, { id: m.id, name: m.name }, v) : undefined}
    />
  )

  const renderCustomRow = (cm: CustomModel) => {
    const catModel = catalogModelIndex?.get(normalizeModelId(cm.id))
    return (
      <ProviderModelRow
        key={cm.id}
        id={cm.id}
        name={cm.name || cm.id}
        mutedWhenDisabled={false}
        catalog={catModel}
        providerBrand={platform.brand}
        trailing={
          <>
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
          </>
        }
      />
    )
  }

  const renderDiscoveredRow = (d: DiscoveredOpenAiModel) => {
    const endpoints = endpointsForTasks(livePlan, d.tasks)
    const { enabled, locked } = modelState(endpoints, d.id)
    const catModel = catalogModelIndex?.get(normalizeModelId(d.id))
    return (
      <ProviderModelRow
        key={d.id}
        id={d.id}
        name={d.name || catModel?.name || d.id}
        enabled={enabled}
        locked={locked}
        lockedHint={t('resources.providerDialog.models.lockedHint')}
        catalog={catModel}
        providerBrand={platform.brand}
        onToggle={(v) => toggleDiscovered(d, v)}
        trailing={
          <span className="flex items-center gap-1">
            {d.tasks.map((tk) => (
              <CapBadge key={tk} icon={TASK_ICON[tk]} title={t(`resources.providerDialog.models.${tk}`)} />
            ))}
            <EditDiscoveredModelPopover
              name={d.name || catModel?.name || ''}
              tasks={d.tasks}
              onSave={({ name, tasks }) => editDiscovered(patchDiscoveredModel(d, { name, tasks }))}
            />
          </span>
        }
      />
    )
  }

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
          {isCustom ? t('resources.providerDialog.models.discover') : t('resources.providerDialog.models.refresh')}
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
                <ModelsListGroupHeader
                  label={t('resources.providerDialog.models.customGroup')}
                  count={customRows.length}
                />
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
                    disabled={discoveredBulk.unlocked.length === 0}
                    onClick={() => {
                      if (discoveredBulk.allOn) disableDiscovered(discoveredBulk.unlocked)
                      else void enableModels(discoveredBulk.unlocked.filter((d) => !modelState(endpointsForTasks(livePlan, d.tasks), d.id).enabled))
                    }}
                  >
                    {discoveredBulk.allOn
                      ? t('resources.providerDialog.models.disableAllDiscovered')
                      : t('resources.providerDialog.models.enableAllDiscovered')}
                  </Button>
                </div>
                {discoveredRows.map(renderDiscoveredRow)}
              </>
            )}
            {selectedCred ? (
              <>
                {enabledRows.length > 0 ? (
                  <ModelsListGroupHeader
                    label={t('resources.providerDialog.models.enabledGroup')}
                    count={enabledRows.length}
                  />
                ) : null}
                {enabledRows.map(renderRow)}
                {disabledRows.length > 0 ? (
                  <ModelsListGroupHeader
                    label={t('resources.providerDialog.models.disabledGroup')}
                    count={disabledRows.length}
                  />
                ) : null}
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
