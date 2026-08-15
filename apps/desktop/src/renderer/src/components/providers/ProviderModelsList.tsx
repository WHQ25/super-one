import { useMemo, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  AudioLines,
  Brain,
  Check,
  FileText,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  Type,
  Video,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Switch } from '@superone/ui/components/ui/switch'
import type { CatalogModality, CatalogModel } from '@superone/shared/model-catalog-types'
import { ModelGlyph } from './ModelGlyph'

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

/** Small icon chip used for tools / reasoning / task badges on a model row. */
export function CapBadge({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <span title={title} className="flex size-5 items-center justify-center rounded bg-muted text-muted-foreground">
      <Icon className="size-3" />
    </span>
  )
}

function formatContext(tokens?: number): string {
  if (!tokens) return ''
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
  return String(tokens)
}

/** Click-to-copy model id, same chip as Settings → AI Provider. */
export function ModelIdBadge({ id }: { id: string }) {
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
      {copied ? (
        <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-green-500">
          {t('resources.providerDialog.models.copied')}
          <Check className="size-3" />
        </span>
      ) : null}
    </span>
  )
}

function catalogSubtitle(m: CatalogModel, t: (key: string, opts?: Record<string, string>) => string): string {
  const parts: string[] = []
  if (m.releaseDate) parts.push(t('resources.providerDialog.models.released', { date: m.releaseDate }))
  if (m.cost) {
    parts.push(`${t('resources.providerDialog.models.priceIn')} $${m.cost.input}/M`)
    parts.push(`${t('resources.providerDialog.models.priceOut')} $${m.cost.output}/M`)
  }
  return parts.join(' · ')
}

function CatalogExtras({ m }: { m: CatalogModel }) {
  const { t } = useTranslation()
  return (
    <>
      <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-1 text-muted-foreground">
        <ModalityIcons mods={m.inputModalities} />
        <ArrowRight className="size-3 opacity-50" />
        <ModalityIcons mods={m.outputModalities} />
      </span>
      {m.toolCall ? <CapBadge icon={Wrench} title={t('resources.providerDialog.models.tools')} /> : null}
      {m.reasoning ? <CapBadge icon={Brain} title={t('resources.providerDialog.models.reasoning')} /> : null}
      {m.contextWindow ? (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {formatContext(m.contextWindow)}
        </span>
      ) : null}
    </>
  )
}

/** Sticky Enabled / Disabled / Custom group label. */
export function ModelsListGroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-background/95 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground backdrop-blur">
      {label}
      <span className="text-muted-foreground/70">({count})</span>
    </div>
  )
}

/**
 * One model row: glyph, name, id chip, optional models.dev extras, enable switch.
 * Shared by Settings → AI Provider and Cursor harness Models tab.
 */
export function ProviderModelRow({
  id,
  name,
  enabled = true,
  mutedWhenDisabled = true,
  providerBrand,
  catalog,
  status,
  locked,
  lockedHint,
  switchDisabled,
  onToggle,
  trailing,
}: {
  id: string
  name: string
  enabled?: boolean
  mutedWhenDisabled?: boolean
  providerBrand?: string
  catalog?: CatalogModel | null
  status?: CatalogModel['status']
  locked?: boolean
  lockedHint?: string
  switchDisabled?: boolean
  onToggle?: (enabled: boolean) => void
  trailing?: ReactNode
}) {
  const { t } = useTranslation()
  const subtitle = catalog ? catalogSubtitle(catalog, t) : ''
  const muted = mutedWhenDisabled && !enabled
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="flex size-7 shrink-0 items-center justify-center">
        <ModelGlyph modelId={id} providerBrand={providerBrand} size={26} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`truncate text-sm font-medium ${muted ? 'text-muted-foreground' : ''}`}>{name}</span>
          <ModelIdBadge id={id} />
          {status ? (
            <span className="shrink-0 rounded bg-amber-500/10 px-1 text-[9px] text-amber-600 dark:text-amber-400">
              {status}
            </span>
          ) : null}
        </div>
        {subtitle ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {catalog ? <CatalogExtras m={catalog} /> : null}
        {trailing}
        {onToggle ? (
          <span title={locked ? lockedHint : undefined} className="flex">
            <Switch
              checked={enabled}
              disabled={locked || switchDisabled}
              onCheckedChange={onToggle}
            />
          </span>
        ) : null}
      </div>
    </div>
  )
}

export type ProviderModelsListItem = {
  id: string
  name: string
  enabled: boolean
  locked?: boolean
  catalog?: CatalogModel | null
  status?: CatalogModel['status']
}

/**
 * Searchable enabled/disabled model list used by AI Provider settings.
 * Cursor harness Models tab reuses this so the two surfaces stay visually identical.
 */
export function ProviderModelsList({
  items,
  providerBrand,
  loading,
  emptyMessage,
  onToggle,
  onRefresh,
  refreshing,
  headerRight,
}: {
  items: ProviderModelsListItem[]
  providerBrand?: string
  loading?: boolean
  emptyMessage?: string
  onToggle: (id: string, enabled: boolean) => void
  onRefresh?: () => void
  refreshing?: boolean
  headerRight?: ReactNode
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (item) => item.id.toLowerCase().includes(q) || item.name.toLowerCase().includes(q),
    )
  }, [items, query])

  const enabledRows = useMemo(() => filtered.filter((r) => r.enabled), [filtered])
  const disabledRows = useMemo(() => filtered.filter((r) => !r.enabled), [filtered])

  const header = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold">{t('resources.providerDialog.models.title')}</span>
        <span className="text-xs text-muted-foreground">
          {t('resources.providerDialog.models.count', { count: items.length })}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-40 rounded-md border border-border bg-background py-1 pr-2 pl-7 text-xs outline-none focus:ring-1 focus:ring-ring"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('resources.providerDialog.models.search')}
          />
        </div>
        {headerRight}
        {onRefresh ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {t('resources.providerDialog.models.refresh')}
          </Button>
        ) : null}
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

  return (
    <div className="flex flex-col gap-3">
      {header}
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {emptyMessage ?? t('resources.providerDialog.models.empty')}
        </p>
      ) : (
        <div className="max-h-[420px] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">{t('resources.providerDialog.models.empty')}</p>
          ) : (
            <>
              {enabledRows.length > 0 ? (
                <>
                  <ModelsListGroupHeader
                    label={t('resources.providerDialog.models.enabledGroup')}
                    count={enabledRows.length}
                  />
                  {enabledRows.map((item) => (
                    <ProviderModelRow
                      key={item.id}
                      id={item.id}
                      name={item.name}
                      enabled={item.enabled}
                      locked={item.locked}
                      lockedHint={t('resources.providerDialog.models.lockedHint')}
                      catalog={item.catalog}
                      status={item.status ?? item.catalog?.status}
                      providerBrand={providerBrand}
                      onToggle={(next) => onToggle(item.id, next)}
                    />
                  ))}
                </>
              ) : null}
              {disabledRows.length > 0 ? (
                <>
                  <ModelsListGroupHeader
                    label={t('resources.providerDialog.models.disabledGroup')}
                    count={disabledRows.length}
                  />
                  {disabledRows.map((item) => (
                    <ProviderModelRow
                      key={item.id}
                      id={item.id}
                      name={item.name}
                      enabled={item.enabled}
                      locked={item.locked}
                      lockedHint={t('resources.providerDialog.models.lockedHint')}
                      catalog={item.catalog}
                      status={item.status ?? item.catalog?.status}
                      providerBrand={providerBrand}
                      onToggle={(next) => onToggle(item.id, next)}
                    />
                  ))}
                </>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  )
}
