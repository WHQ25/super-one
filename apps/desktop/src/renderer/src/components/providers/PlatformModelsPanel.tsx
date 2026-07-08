import { useMemo, useState } from 'react'
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
  Type,
  Video,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ModelIcon, modelMappings } from '@lobehub/icons'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import type { CapabilityTask } from '@superone/shared/agent-types'
import { catalogProviderIdFor, type Plan, type Platform } from '@superone/shared/platform-registry'
import type { CatalogModality, CatalogModel, CatalogProvider } from '@superone/shared/model-catalog-types'
import { MODEL_TASK_ORDER, modelTasks } from '@superone/shared/model-tasks'
import { useModelCatalog } from '@/hooks/useModelCatalog'
import { ProviderLabel } from '../ProviderLabel'

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

export function PlatformModelsPanel({ platform, plan }: { platform: Platform; plan: Plan }) {
  const { t } = useTranslation()
  const { catalog, loading, refreshing, refresh } = useModelCatalog()
  const catProvider = useMemo(
    () => (catalog ? matchCatalogProvider(catalog.providers, platform, plan) : null),
    [catalog, platform, plan],
  )

  const annotated = useMemo(
    () =>
      (catProvider?.models ?? [])
        .map((m) => ({ m, tasks: modelTasks(m), iconMatched: hasModelIcon(m.id) }))
        .sort((a, b) => (b.m.releaseDate ?? '').localeCompare(a.m.releaseDate ?? '')),
    [catProvider],
  )

  const taskCounts = useMemo(() => {
    const counts = new Map<CapabilityTask, number>()
    for (const { tasks } of annotated) for (const tk of tasks) counts.set(tk, (counts.get(tk) ?? 0) + 1)
    return counts
  }, [annotated])
  const presentTasks = MODEL_TASK_ORDER.filter((tk) => taskCounts.has(tk))

  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const activeTab: Tab = tab !== 'all' && !taskCounts.has(tab) ? 'all' : tab

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return annotated.filter(({ m, tasks }) => {
      if (activeTab !== 'all' && !tasks.includes(activeTab)) return false
      if (q && !m.id.toLowerCase().includes(q) && !m.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [annotated, activeTab, query])

  const subtitle = (m: CatalogModel): string => {
    const parts: string[] = []
    if (m.releaseDate) parts.push(t('resources.providerDialog.models.released', { date: m.releaseDate }))
    if (m.cost) {
      parts.push(`${t('resources.providerDialog.models.priceIn')} $${m.cost.input}/M`)
      parts.push(`${t('resources.providerDialog.models.priceOut')} $${m.cost.output}/M`)
    }
    return parts.join(' · ')
  }

  const header = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold">{t('resources.providerDialog.models.title')}</span>
        <span className="text-xs text-muted-foreground">{t('resources.providerDialog.models.count', { count: annotated.length })}</span>
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
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
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

  if (!catProvider) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <p className="p-4 text-xs text-muted-foreground">{t('resources.providerDialog.models.noEntry')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {header}

      <div className="flex items-center gap-1 border-b border-border">
        <TabButton active={activeTab === 'all'} onClick={() => setTab('all')} icon={LayoutGrid} label={t('resources.providerDialog.models.all')} count={annotated.length} />
        {presentTasks.map((tk) => (
          <TabButton key={tk} active={activeTab === tk} onClick={() => setTab(tk)} icon={TASK_ICON[tk]} label={t(`resources.providerDialog.models.${tk}`)} count={taskCounts.get(tk) ?? 0} />
        ))}
      </div>

      <div className="max-h-[420px] overflow-y-auto">
        {visible.length === 0 && <p className="p-4 text-xs text-muted-foreground">{t('resources.providerDialog.models.empty')}</p>}
        {visible.map(({ m, iconMatched }) => (
          <div key={m.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="flex size-7 shrink-0 items-center justify-center">
              {iconMatched
                ? <ModelIcon model={m.id} type="color" size={26} />
                : <ProviderLabel brandKey={platform.brand} iconOnly size={26} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{m.name}</span>
                <ModelIdBadge id={m.id} />
                {m.status && <span className="shrink-0 rounded bg-amber-500/10 px-1 text-[9px] text-amber-600 dark:text-amber-400">{m.status}</span>}
              </div>
              {subtitle(m) && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle(m)}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-1 text-muted-foreground">
                <ModalityIcons mods={m.inputModalities} />
                <ArrowRight className="size-3 opacity-50" />
                <ModalityIcons mods={m.outputModalities} />
              </span>
              {m.toolCall && <CapBadge icon={Wrench} title={t('resources.providerDialog.models.tools')} />}
              {m.reasoning && <CapBadge icon={Brain} title={t('resources.providerDialog.models.reasoning')} />}
              {m.contextWindow ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{formatContext(m.contextWindow)}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
