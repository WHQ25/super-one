import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AudioLines,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Mic,
  RefreshCw,
  Search,
  Video,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import type { CapabilityTask, DiscoverModelsResult, DiscoveredOpenAiModel } from '@superone/shared/agent-types'
import { buildCatalogModelIndex, normalizeModelId } from '@superone/shared/platform-registry'
import { MODEL_TASK_ORDER } from '@superone/shared/model-tasks'
import { useModelCatalog } from '@/hooks/useModelCatalog'
import { applyCatalogDisplayNames, patchDiscoveredModel } from './discovery-apply'
import { EditDiscoveredModelPopover } from './EditDiscoveredModelPopover'
import { CapBadge, ProviderModelRow } from './ProviderModelsList'
import type { DiscoverState } from './useModelDiscovery'

const TASK_ICON: Record<CapabilityTask, LucideIcon> = {
  chat: MessageSquare,
  image: ImageIcon,
  video: Video,
  tts: AudioLines,
  asr: Mic,
}

export function DraftDiscoveredModels({
  baseUrl,
  apiKey,
  enabledIds,
  onToggle,
  onBulkSet,
  onResult,
  autoStart = false,
}: {
  baseUrl: string
  apiKey: string
  enabledIds: ReadonlySet<string>
  onToggle: (model: DiscoveredOpenAiModel, enabled: boolean) => void
  onBulkSet: (models: DiscoveredOpenAiModel[], enabled: boolean) => void
  onResult: (result: DiscoverModelsResult) => void
  autoStart?: boolean
}) {
  const { t } = useTranslation()
  const { catalog } = useModelCatalog()
  const catalogModelIndex = useMemo(() => (catalog ? buildCatalogModelIndex(catalog) : null), [catalog])
  const [models, setModels] = useState<DiscoveredOpenAiModel[]>([])
  const [state, setState] = useState<DiscoverState>({ status: 'idle' })
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'all' | CapabilityTask>('all')
  const requestId = useRef(0)
  const started = useRef(false)
  const lastResult = useRef<DiscoverModelsResult | null>(null)

  const canDiscover = !!baseUrl.trim() && !!apiKey.trim()

  const emit = useCallback((next: DiscoveredOpenAiModel[]) => {
    const named = applyCatalogDisplayNames(next, catalogModelIndex)
    setModels(named)
    const base = lastResult.current
    const result: DiscoverModelsResult = base
      ? { ...base, models: named }
      : { models: named, truncated: false, sources: { pricing: 'unavailable', modelsList: 'ok' } }
    lastResult.current = result
    onResult(result)
  }, [catalogModelIndex, onResult])

  const discover = useCallback(async () => {
    const trimmedBase = baseUrl.trim()
    const trimmedKey = apiKey.trim()
    if (!trimmedBase || !trimmedKey) return
    const id = ++requestId.current
    setState({ status: 'loading' })
    try {
      const result = await window.app.discoverProviderModels({
        apiKey: trimmedKey,
        endpoint: { id: 'openai', baseUrl: trimmedBase, protocols: ['openai-chat'] },
      })
      if (id !== requestId.current) return
      lastResult.current = result
      setState({ status: 'done', truncated: result.truncated })
      try {
        emit(result.models)
      } catch (err) {
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    } catch (err) {
      if (id !== requestId.current) return
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [apiKey, baseUrl, emit])

  useEffect(() => {
    if (!autoStart || started.current) return
    started.current = true
    void discover()
  }, [autoStart, discover])

  useEffect(() => {
    if (!catalogModelIndex || !lastResult.current) return
    const named = applyCatalogDisplayNames(lastResult.current.models, catalogModelIndex)
    if (named !== lastResult.current.models) emit(named)
  }, [catalogModelIndex, emit])

  const taskCounts = useMemo(() => {
    const counts = new Map<CapabilityTask, number>()
    for (const m of models) for (const tk of m.tasks) counts.set(tk, (counts.get(tk) ?? 0) + 1)
    return counts
  }, [models])
  const presentTasks = MODEL_TASK_ORDER.filter((tk) => taskCounts.has(tk))
  const activeTab: 'all' | CapabilityTask = tab !== 'all' && !taskCounts.has(tab) ? 'all' : tab

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return models.filter((m) => {
      if (activeTab !== 'all' && !m.tasks.includes(activeTab)) return false
      if (q && !m.id.toLowerCase().includes(q) && !(m.name ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [models, activeTab, query])
  const allRowsEnabled = rows.length > 0 && rows.every((m) => enabledIds.has(m.id))

  if (!canDiscover && models.length === 0) return null

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{t('resources.providerDialog.models.title')}</span>
          <span className="text-xs text-muted-foreground">{t('resources.providerDialog.models.count', { count: models.length })}</span>
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
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void discover()} disabled={!canDiscover || state.status === 'loading'}>
            {state.status === 'loading' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {t('resources.providerDialog.models.discover')}
          </Button>
        </div>
      </div>

      {state.status === 'error' && (
        <p className="text-xs text-destructive">{t('resources.providerDialog.models.discoverError', { message: state.message })}</p>
      )}
      {state.status === 'done' && models.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('resources.providerDialog.models.discoverEmpty')}</p>
      )}

      {models.length > 0 && (
        <>
          <div className="flex items-center gap-1 border-b border-border">
            <TabButton
              active={activeTab === 'all'}
              onClick={() => setTab('all')}
              icon={LayoutGrid}
              label={t('resources.providerDialog.models.all')}
              count={models.length}
            />
            {presentTasks.map((tk) => (
              <TabButton
                key={tk}
                active={activeTab === tk}
                onClick={() => setTab(tk)}
                icon={TASK_ICON[tk]}
                label={t(`resources.providerDialog.models.${tk}`)}
                count={taskCounts.get(tk) ?? 0}
              />
            ))}
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            <div className="flex items-center justify-between gap-1.5 bg-background/95 px-3 py-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t('resources.providerDialog.models.discoveredGroup')}{' '}
                <span className="text-muted-foreground/70">({rows.length})</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[11px]"
                disabled={rows.length === 0}
                onClick={() => onBulkSet(rows, !allRowsEnabled)}
              >
                {allRowsEnabled
                  ? t('resources.providerDialog.models.disableAllDiscovered')
                  : t('resources.providerDialog.models.enableAllDiscovered')}
              </Button>
            </div>
            {rows.map((m) => (
              <DraftRow
                key={m.id}
                model={m}
                enabled={enabledIds.has(m.id)}
                catalogModelIndex={catalogModelIndex}
                onToggle={onToggle}
                onPatch={(next) => emit(models.map((row) => (row.id === next.id ? next : row)))}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  icon: LucideIcon
  label: string
  count: number
}) {
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

function DraftRow({
  model,
  enabled,
  catalogModelIndex,
  onToggle,
  onPatch,
}: {
  model: DiscoveredOpenAiModel
  enabled: boolean
  catalogModelIndex: ReturnType<typeof buildCatalogModelIndex> | null
  onToggle: (model: DiscoveredOpenAiModel, enabled: boolean) => void
  onPatch: (model: DiscoveredOpenAiModel) => void
}) {
  const { t } = useTranslation()
  const catModel = catalogModelIndex?.get(normalizeModelId(model.id))
  return (
    <ProviderModelRow
      id={model.id}
      name={model.name || catModel?.name || model.id}
      enabled={enabled}
      catalog={catModel}
      providerBrand="custom"
      onToggle={(v) => onToggle(model, v)}
      trailing={
        <span className="flex items-center gap-1">
          {model.tasks.map((tk) => (
            <CapBadge key={tk} icon={TASK_ICON[tk]} title={t(`resources.providerDialog.models.${tk}`)} />
          ))}
          <EditDiscoveredModelPopover
            name={model.name || catModel?.name || ''}
            tasks={model.tasks}
            onSave={({ name, tasks }) => onPatch(patchDiscoveredModel(model, { name, tasks }))}
          />
        </span>
      }
    />
  )
}
