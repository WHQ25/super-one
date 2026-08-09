import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '@superone/ui/lib/utils'
import { buildCatalogModelIndex, normalizeModelId } from '@superone/shared/platform-registry'
import {
  estimateUsageCostBreakdown,
  formatUsd,
  type UsageCostBreakdown,
} from '@superone/shared/usage-cost'
import type { CatalogModel } from '@superone/shared/model-catalog-types'
import { useModelCatalog } from '@/hooks/useModelCatalog'
import { useChatStore } from '@/stores/chat'
import { ModelGlyph } from './providers/ModelGlyph'
import {
  buildUsageModelNameIndex,
  resolveUsageModelPresentation,
  type UsageHarness,
  usageModelId,
} from './usage-model-presentation'

function SizedChart({ height, className, children }: { height: number | string; className?: string; children: (size: { width: number; height: number }) => ReactNode }) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      setSize({ width: Math.max(0, Math.floor(rect.width)), height: Math.max(0, Math.floor(rect.height)) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const heightStyle = typeof height === 'number' ? `${height}px` : height
  return (
    <div
      ref={ref}
      style={{ height: heightStyle, minWidth: 0 }}
      className={cn('usage-chart w-full outline-none', className)}
    >
      {size.width > 0 && size.height > 0 ? children(size) : null}
    </div>
  )
}

type Harness = UsageHarness
type HarnessFilter = 'all' | Harness

interface UsageRow {
  day: string
  harness: Harness
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
}

interface ByModelRow {
  harness: Harness
  model: string
  displayName: string
  providerBrand: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  /** Estimated USD from models.dev; null when the model has no list price. */
  costUsd: number | null
  costInput: number
  costOutput: number
  costCacheRead: number
  costCacheCreation: number
}

type RangePreset = 'today' | '7d' | '30d' | '90d' | 'all'

const PRESETS: { id: RangePreset; days: number | null }[] = [
  { id: 'today', days: 1 },
  { id: '7d', days: 7 },
  { id: '30d', days: 30 },
  { id: '90d', days: 90 },
  { id: 'all', days: null },
]

const HARNESS_FILTERS: HarnessFilter[] = ['all', 'claude', 'codex', 'grok']

const TOKEN_TYPE_KEYS = ['input', 'output', 'cacheRead', 'cacheCreation'] as const
type TokenTypeKey = typeof TOKEN_TYPE_KEYS[number]

const TOKEN_TYPE_COLORS: Record<TokenTypeKey, { fill: string; opacity: number }> = {
  input: { fill: 'var(--primary)', opacity: 1 },
  output: { fill: 'var(--primary)', opacity: 0.65 },
  cacheRead: { fill: 'var(--foreground)', opacity: 0.3 },
  cacheCreation: { fill: 'var(--foreground)', opacity: 0.5 },
}

function formatNumber(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 2 : 1)}K`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`
  return `${(n / 1_000_000_000).toFixed(n < 10_000_000_000 ? 2 : 1)}B`
}

function localDay(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function rowTotal(r: UsageRow): number {
  return r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_creation_tokens
}

function zeroCostBreakdown(): UsageCostBreakdown {
  return { total: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
}

function rowCostBreakdown(
  r: UsageRow,
  catalogModels: ReadonlyMap<string, CatalogModel>,
): UsageCostBreakdown | null {
  const model = catalogModels.get(normalizeModelId(usageModelId(r.model)))
  return estimateUsageCostBreakdown(
    {
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheReadTokens: r.cache_read_tokens,
      cacheCreationTokens: r.cache_creation_tokens,
    },
    model?.cost,
  )
}

export function UsagePage() {
  const { t } = useTranslation()
  const { catalog } = useModelCatalog()
  const harnessResources = useChatStore((state) => state.harnessResources)
  const [rows, setRows] = useState<UsageRow[]>([])
  const [counts, setCounts] = useState<{ sessions: number; messages: number }>({ sessions: 0, messages: 0 })
  const [loading, setLoading] = useState(true)
  const [backfilling, setBackfilling] = useState(false)
  const [preset, setPreset] = useState<RangePreset>('today')
  const [harnessFilter, setHarnessFilter] = useState<HarnessFilter>('all')
  const catalogModels = useMemo(
    () => catalog ? buildCatalogModelIndex(catalog) : new Map(),
    [catalog],
  )
  const knownModelNames = useMemo(() => {
    const acpModels = Object.values(harnessResources.acp?.modelsByAgentId ?? {})
      .flatMap((entry) => entry.models)
    const acpExtraModels = Object.values(harnessResources.acp?.configByAgentId ?? {})
      .flatMap((entry) => entry.extraModels ?? [])
    return buildUsageModelNameIndex([
      ...(harnessResources.claude?.models ?? []),
      ...(harnessResources.codex?.models ?? []),
      ...acpModels,
      ...acpExtraModels,
    ])
  }, [harnessResources])

  const range = useMemo(() => {
    const found = PRESETS.find((p) => p.id === preset)
    if (!found || found.days == null) return {}
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - found.days + 1)
    return { from: localDay(from), to: localDay(to) }
  }, [preset])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const harnessParam = harnessFilter === 'all' ? undefined : harnessFilter
      const [main, countsResp, status] = await Promise.all([
        window.app.queryUsage(range),
        window.app.queryUsageCounts({ ...range, harness: harnessParam }),
        window.app.getUsageBackfillStatus(),
      ])
      setRows(main.rows)
      setCounts(countsResp)
      setBackfilling(status === 'pending')
      setLoading(false)
    } catch (e) {
      setLoading(false)
      throw e
    }
  }, [range, harnessFilter])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const off = window.app.onUsageBackfillDone(() => {
      setBackfilling(false)
      refresh()
    })
    return off
  }, [refresh])

  const filteredRows = useMemo(() => {
    if (harnessFilter === 'all') return rows
    return rows.filter((r) => r.harness === harnessFilter)
  }, [rows, harnessFilter])

  const filteredTokenTotal = useMemo(() => {
    let total = 0
    for (const r of filteredRows) total += rowTotal(r)
    return total
  }, [filteredRows])

  const costSummary = useMemo(() => {
    let total = 0
    let unpricedModels = 0
    const seenUnpriced = new Set<string>()
    for (const r of filteredRows) {
      const cost = rowCostBreakdown(r, catalogModels)
      if (cost) {
        total += cost.total
      } else if (rowTotal(r) > 0) {
        const key = `${r.harness}::${usageModelId(r.model)}`
        if (!seenUnpriced.has(key)) {
          seenUnpriced.add(key)
          unpricedModels++
        }
      }
    }
    return { total, unpricedModels }
  }, [filteredRows, catalogModels])

  const dailyByHarness = useMemo(() => {
    const byDay = new Map<string, {
      claude: number; codex: number; grok: number
      claudeCost: number; codexCost: number; grokCost: number
    }>()
    for (const r of rows) {
      const cur = byDay.get(r.day) ?? {
        claude: 0, codex: 0, grok: 0,
        claudeCost: 0, codexCost: 0, grokCost: 0,
      }
      const tokens = rowTotal(r)
      const cost = rowCostBreakdown(r, catalogModels)?.total ?? 0
      if (r.harness === 'claude') {
        cur.claude += tokens
        cur.claudeCost += cost
      } else if (r.harness === 'codex') {
        cur.codex += tokens
        cur.codexCost += cost
      } else {
        cur.grok += tokens
        cur.grokCost += cost
      }
      byDay.set(r.day, cur)
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a < b ? -1 : 1)
      .map(([day, v]) => ({ day, ...v }))
  }, [rows, catalogModels])

  const dailyByTokenType = useMemo(() => {
    const byDay = new Map<string, {
      input: number; output: number; cacheRead: number; cacheCreation: number
      costInput: number; costOutput: number; costCacheRead: number; costCacheCreation: number
    }>()
    for (const r of filteredRows) {
      const cur = byDay.get(r.day) ?? {
        input: 0, output: 0, cacheRead: 0, cacheCreation: 0,
        costInput: 0, costOutput: 0, costCacheRead: 0, costCacheCreation: 0,
      }
      cur.input += r.input_tokens
      cur.output += r.output_tokens
      cur.cacheRead += r.cache_read_tokens
      cur.cacheCreation += r.cache_creation_tokens
      const cost = rowCostBreakdown(r, catalogModels) ?? zeroCostBreakdown()
      cur.costInput += cost.input
      cur.costOutput += cost.output
      cur.costCacheRead += cost.cacheRead
      cur.costCacheCreation += cost.cacheCreation
      byDay.set(r.day, cur)
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a < b ? -1 : 1)
      .map(([day, v]) => ({ day, ...v }))
  }, [filteredRows, catalogModels])

  const byModel = useMemo(() => {
    const map = new Map<string, ByModelRow>()
    for (const r of filteredRows) {
      const model = usageModelId(r.model)
      const key = `${r.harness}::${model}`
      const cur = map.get(key) ?? {
        harness: r.harness,
        model,
        ...resolveUsageModelPresentation(model, r.harness, catalogModels, knownModelNames),
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        costUsd: null as number | null,
        costInput: 0,
        costOutput: 0,
        costCacheRead: 0,
        costCacheCreation: 0,
      }
      cur.input += r.input_tokens
      cur.output += r.output_tokens
      cur.cacheRead += r.cache_read_tokens
      cur.cacheCreation += r.cache_creation_tokens
      const cost = rowCostBreakdown(r, catalogModels)
      if (cost) {
        cur.costUsd = (cur.costUsd ?? 0) + cost.total
        cur.costInput += cost.input
        cur.costOutput += cost.output
        cur.costCacheRead += cost.cacheRead
        cur.costCacheCreation += cost.cacheCreation
      }
      map.set(key, cur)
    }
    return Array.from(map.values()).sort((a, b) => {
      return (b.input + b.output + b.cacheRead + b.cacheCreation) - (a.input + a.output + a.cacheRead + a.cacheCreation)
    })
  }, [filteredRows, catalogModels, knownModelNames])

  const isAll = harnessFilter === 'all'
  const isToday = preset === 'today'
  const isHeatmap = preset === 'all'
  const isAreaRange = preset === '90d'
  const dayTotalsMap = useMemo(() => {
    const m = new Map<string, { tokens: number; cost: number }>()
    for (const r of filteredRows) {
      const cur = m.get(r.day) ?? { tokens: 0, cost: 0 }
      cur.tokens += rowTotal(r)
      cur.cost += rowCostBreakdown(r, catalogModels)?.total ?? 0
      m.set(r.day, cur)
    }
    return m
  }, [filteredRows, catalogModels])
  const chartData = isToday ? byModel : (isAll ? dailyByHarness : dailyByTokenType)
  const chartEmpty = isHeatmap ? dayTotalsMap.size === 0 : chartData.length === 0
  const chartTitleKey = isHeatmap
    ? 'settings.usage.daily.titleHeatmap'
    : isToday
      ? 'settings.usage.daily.titleToday'
      : isAll
        ? 'settings.usage.daily.titleByHarness'
        : 'settings.usage.daily.titleByTokenType'

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">{t('settings.usage.title')}</h2>
        {backfilling && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            <span>{t('settings.usage.backfilling')}</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                preset === p.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t(`settings.usage.presets.${p.id}`)}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border border-border p-0.5">
          {HARNESS_FILTERS.map((h) => (
            <button
              key={h}
              onClick={() => setHarnessFilter(h)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                harnessFilter === h
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`settings.usage.harness.${h}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label={t('settings.usage.summary.totalTokens')} value={formatNumber(filteredTokenTotal)} />
        <SummaryCard
          label={t('settings.usage.summary.estimatedCost')}
          value={formatUsd(costSummary.total)}
          hint={
            costSummary.unpricedModels > 0
              ? t('settings.usage.summary.unpricedHint', { count: costSummary.unpricedModels })
              : t('settings.usage.summary.estimatedCostHint')
          }
        />
        <SummaryCard label={t('settings.usage.summary.sessions')} value={counts.sessions.toLocaleString()} />
        <SummaryCard label={t('settings.usage.summary.messages')} value={counts.messages.toLocaleString()} />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">{t(chartTitleKey)}</h3>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {isHeatmap ? (
              <HeatmapLegend t={t} />
            ) : isToday || !isAll ? (
              TOKEN_TYPE_KEYS.map((key) => (
                <LegendDot
                  key={key}
                  fill={TOKEN_TYPE_COLORS[key].fill}
                  opacity={TOKEN_TYPE_COLORS[key].opacity}
                  label={t(`settings.usage.tokenTypes.${key}`)}
                />
              ))
            ) : (
              <>
                <LegendDot fill="var(--primary)" label="Claude" />
                <LegendDot fill="var(--foreground)" opacity={0.4} label="Codex" />
                <LegendDot fill="var(--warning)" opacity={0.75} label="Grok" />
              </>
            )}
          </div>
        </div>
        {loading && rows.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : chartEmpty ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            {t('settings.usage.daily.empty')}
          </div>
        ) : isHeatmap ? (
          <ContributionHeatmap dayTotals={dayTotalsMap} t={t} />
        ) : isToday ? (
          <TodayByModelChart data={byModel} t={t} />
        ) : isAll ? (
          isAreaRange
            ? <DailyHarnessAreaChart data={dailyByHarness} t={t} />
            : <DailyHarnessChart data={dailyByHarness} t={t} showTopLabels={preset === '7d'} />
        ) : (
          isAreaRange
            ? <DailyTokenTypeAreaChart data={dailyByTokenType} t={t} />
            : <DailyTokenTypeChart data={dailyByTokenType} t={t} showTopLabels={preset === '7d'} />
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-medium">{t('settings.usage.byModel.title')}</h3>
        </div>
        {byModel.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            {t('settings.usage.byModel.empty')}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left font-normal">{t('settings.usage.byModel.model')}</th>
                <th className="px-4 py-2 text-right font-normal">{t('settings.usage.byModel.input')}</th>
                <th className="px-4 py-2 text-right font-normal">{t('settings.usage.byModel.output')}</th>
                <th className="px-4 py-2 text-right font-normal">{t('settings.usage.byModel.cacheRead')}</th>
                <th className="px-4 py-2 text-right font-normal">{t('settings.usage.byModel.cacheCreation')}</th>
                <th className="px-4 py-2 text-right font-normal">{t('settings.usage.byModel.total')}</th>
                <th className="px-4 py-2 text-right font-normal">{t('settings.usage.byModel.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((m) => {
                const total = m.input + m.output + m.cacheRead + m.cacheCreation
                return (
                  <tr key={`${m.harness}::${m.model}`} className="border-b border-border/50 last:border-b-0">
                    <td className="px-4 py-2">
                      <div className="flex min-w-0 items-center gap-2" title={m.model}>
                        <span className="flex size-5 shrink-0 items-center justify-center">
                          <ModelGlyph modelId={m.model} providerBrand={m.providerBrand} size={18} />
                        </span>
                        <span className="truncate font-medium">{m.displayName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatNumber(m.input)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatNumber(m.output)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatNumber(m.cacheRead)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatNumber(m.cacheCreation)}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatNumber(total)}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">
                      {m.costUsd == null ? t('settings.usage.byModel.unpriced') : formatUsd(m.costUsd)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const HEATMAP_LEVEL_OPACITY = [0, 0.2, 0.45, 0.7, 1] as const

function computeHeatmapThresholds(values: number[]): number[] {
  const nonZero = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (nonZero.length === 0) return [0, 0, 0, 0]
  const q = (p: number): number => {
    const idx = Math.min(nonZero.length - 1, Math.floor(p * nonZero.length))
    return nonZero[idx]
  }
  return [q(0.25), q(0.5), q(0.75), q(0.9)]
}

function intensityLevel(value: number, thresholds: number[]): number {
  if (value <= 0) return 0
  if (value <= thresholds[0]) return 1
  if (value <= thresholds[1]) return 2
  if (value <= thresholds[2]) return 3
  return 4
}

function parseLocalDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

type HeatmapCell = { x: number; y: number; level: number; date: string; tokens: number; cost: number }

function ContributionHeatmap({
  dayTotals,
  t,
}: {
  dayTotals: Map<string, { tokens: number; cost: number }>
  t: (key: string) => string
}) {
  const [hover, setHover] = useState<HeatmapCell | null>(null)
  if (dayTotals.size === 0) return null
  const days = Array.from(dayTotals.keys()).sort()
  const earliest = parseLocalDay(days[0])
  const latest = parseLocalDay(days[days.length - 1])

  const start = new Date(earliest)
  start.setDate(start.getDate() - start.getDay())
  const end = new Date(latest)
  end.setDate(end.getDate() + (6 - end.getDay()))

  const totalDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
  const cols = Math.ceil(totalDays / 7)
  const cellSize = 12
  const gap = 3
  const stride = cellSize + gap
  const monthLabelHeight = 16
  const dayLabelWidth = 24
  const width = dayLabelWidth + cols * stride
  const height = monthLabelHeight + 7 * stride

  const thresholds = computeHeatmapThresholds(Array.from(dayTotals.values()).map((v) => v.tokens))

  const cells: HeatmapCell[] = []
  const monthLabels: Array<{ x: number; label: string }> = []
  const monthAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  let lastMonth = -1

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < 7; row++) {
      const cellDate = new Date(start)
      cellDate.setDate(cellDate.getDate() + col * 7 + row)
      if (cellDate > latest || cellDate < earliest) continue
      const y = cellDate.getFullYear()
      const m = String(cellDate.getMonth() + 1).padStart(2, '0')
      const d = String(cellDate.getDate()).padStart(2, '0')
      const key = `${y}-${m}-${d}`
      const totals = dayTotals.get(key) ?? { tokens: 0, cost: 0 }
      cells.push({
        x: dayLabelWidth + col * stride,
        y: monthLabelHeight + row * stride,
        level: intensityLevel(totals.tokens, thresholds),
        date: key,
        tokens: totals.tokens,
        cost: totals.cost,
      })
      if (row === 0 && cellDate.getMonth() !== lastMonth && cellDate.getDate() <= 7) {
        monthLabels.push({ x: dayLabelWidth + col * stride, label: monthAbbr[cellDate.getMonth()] })
        lastMonth = cellDate.getMonth()
      }
    }
  }

  const dayLabels = [
    { row: 1, label: 'Mon' },
    { row: 3, label: 'Wed' },
    { row: 5, label: 'Fri' },
  ]

  return (
    <div className="usage-chart relative w-full overflow-x-auto outline-none">
      <svg width={width} height={height} className="overflow-visible outline-none" focusable="false">
        {monthLabels.map((m) => (
          <text key={`${m.x}-${m.label}`} x={m.x} y={11} className="fill-muted-foreground" style={{ fontSize: 10 }}>
            {m.label}
          </text>
        ))}
        {dayLabels.map((d) => (
          <text
            key={d.label}
            x={0}
            y={monthLabelHeight + d.row * stride + 9}
            className="fill-muted-foreground"
            style={{ fontSize: 10 }}
          >
            {d.label}
          </text>
        ))}
        {cells.map((cell) => (
          <rect
            key={cell.date}
            x={cell.x}
            y={cell.y}
            width={cellSize}
            height={cellSize}
            rx={2}
            ry={2}
            fill={cell.level === 0 ? 'var(--muted)' : 'var(--primary)'}
            fillOpacity={cell.level === 0 ? 1 : HEATMAP_LEVEL_OPACITY[cell.level]}
            stroke={hover?.date === cell.date ? 'var(--ring)' : 'transparent'}
            strokeWidth={1}
            onMouseEnter={() => setHover(cell)}
            onMouseLeave={() => setHover((prev) => (prev?.date === cell.date ? null : prev))}
            style={{ cursor: 'pointer' }}
          />
        ))}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
          style={{ left: hover.x + cellSize, top: hover.y - 8 }}
        >
          <div className="font-medium">{hover.date}</div>
          <div className="text-muted-foreground">
            {hover.tokens > 0
              ? `${formatNumber(hover.tokens)} ${t('settings.usage.heatmap.tokens')} · ${formatUsd(hover.cost)}`
              : t('settings.usage.heatmap.noActivity')}
          </div>
        </div>
      )}
    </div>
  )
}

function HeatmapLegend({ t }: { t: (key: string) => string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span>{t('settings.usage.heatmap.less')}</span>
      {HEATMAP_LEVEL_OPACITY.map((opacity, idx) => (
        <span
          key={idx}
          className="size-2.5 rounded-sm"
          style={{
            backgroundColor: idx === 0 ? 'var(--muted)' : 'var(--primary)',
            opacity: idx === 0 ? 1 : opacity,
          }}
        />
      ))}
      <span>{t('settings.usage.heatmap.more')}</span>
    </div>
  )
}

interface DailyHarnessRow {
  day: string
  claude: number
  codex: number
  grok: number
  claudeCost: number
  codexCost: number
  grokCost: number
}
interface DailyTokenTypeRow {
  day: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  costInput: number
  costOutput: number
  costCacheRead: number
  costCacheCreation: number
}

const TOKEN_TYPE_COST_KEYS: Record<TokenTypeKey, keyof DailyTokenTypeRow> = {
  input: 'costInput',
  output: 'costOutput',
  cacheRead: 'costCacheRead',
  cacheCreation: 'costCacheCreation',
}

function DailyHarnessAreaChart({ data, t }: { data: DailyHarnessRow[]; t: (key: string) => string }) {
  return (
    <SizedChart height={224}>
      {({ width: cw, height: ch }) => (
        <AreaChart width={cw} height={ch} data={data} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
          <defs>
            <linearGradient id="claudeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.6} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id="codexFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--foreground)" stopOpacity={0.4} />
              <stop offset="100%" stopColor="var(--foreground)" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="grokFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--warning)" stopOpacity={0.55} />
              <stop offset="100%" stopColor="var(--warning)" stopOpacity={0.08} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="day"
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={48}
          />
          <YAxis hide domain={[0, 'dataMax']} />
          <Tooltip
            cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '3 3' }}
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null
              const row = payload[0]?.payload as DailyHarnessRow | undefined
              const claude = row?.claude ?? 0
              const codex = row?.codex ?? 0
              const grok = row?.grok ?? 0
              return (
                <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                  <div className="mb-1 font-medium">{label}</div>
                  <TooltipRow color="var(--primary)" label="Claude" tokens={claude} cost={row?.claudeCost ?? 0} />
                  <TooltipRow color="var(--foreground)" opacity={0.4} label="Codex" tokens={codex} cost={row?.codexCost ?? 0} />
                  <TooltipRow color="var(--warning)" opacity={0.75} label="Grok" tokens={grok} cost={row?.grokCost ?? 0} />
                  <TooltipRow
                    color="transparent"
                    label={t('settings.usage.tooltip.total')}
                    tokens={claude + codex + grok}
                    cost={(row?.claudeCost ?? 0) + (row?.codexCost ?? 0) + (row?.grokCost ?? 0)}
                    bold
                  />
                </div>
              )
            }}
          />
          <Area type="monotone" dataKey="codex" stackId="usage" stroke="var(--foreground)" strokeOpacity={0.4} strokeWidth={1.5} fill="url(#codexFill)" />
          <Area type="monotone" dataKey="grok" stackId="usage" stroke="var(--warning)" strokeOpacity={0.75} strokeWidth={1.5} fill="url(#grokFill)" />
          <Area type="monotone" dataKey="claude" stackId="usage" stroke="var(--primary)" strokeWidth={1.5} fill="url(#claudeFill)" />
        </AreaChart>
      )}
    </SizedChart>
  )
}

function DailyTokenTypeAreaChart({ data, t }: { data: DailyTokenTypeRow[]; t: (key: string) => string }) {
  return (
    <SizedChart height={224}>
      {({ width: cw, height: ch }) => (
        <AreaChart width={cw} height={ch} data={data} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
          <XAxis
            dataKey="day"
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={48}
          />
          <YAxis hide domain={[0, 'dataMax']} />
          <Tooltip
            cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '3 3' }}
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null
              const row = payload[0]?.payload as DailyTokenTypeRow | undefined
              const values: Record<TokenTypeKey, number> = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
              const costs: Record<TokenTypeKey, number> = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
              for (const k of TOKEN_TYPE_KEYS) {
                values[k] = row?.[k] ?? 0
                costs[k] = (row?.[TOKEN_TYPE_COST_KEYS[k]] as number | undefined) ?? 0
              }
              const total = values.input + values.output + values.cacheRead + values.cacheCreation
              const totalCost = costs.input + costs.output + costs.cacheRead + costs.cacheCreation
              return (
                <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                  <div className="mb-1 font-medium">{label}</div>
                  {TOKEN_TYPE_KEYS.map((k) => (
                    <TooltipRow
                      key={k}
                      color={TOKEN_TYPE_COLORS[k].fill}
                      opacity={TOKEN_TYPE_COLORS[k].opacity}
                      label={t(`settings.usage.tokenTypes.${k}`)}
                      tokens={values[k]}
                      cost={costs[k]}
                    />
                  ))}
                  <TooltipRow color="transparent" label={t('settings.usage.tooltip.total')} tokens={total} cost={totalCost} bold />
                </div>
              )
            }}
          />
          {TOKEN_TYPE_KEYS.map((key) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stackId="tokens"
              stroke={TOKEN_TYPE_COLORS[key].fill}
              strokeOpacity={TOKEN_TYPE_COLORS[key].opacity}
              strokeWidth={1.5}
              fill={TOKEN_TYPE_COLORS[key].fill}
              fillOpacity={TOKEN_TYPE_COLORS[key].opacity * 0.5}
            />
          ))}
        </AreaChart>
      )}
    </SizedChart>
  )
}

function TodayByModelChart({ data, t }: { data: ByModelRow[]; t: (key: string) => string }) {
  const chartData = data.map((m) => ({
    key: `${m.harness}::${m.model}`,
    model: m.model,
    displayName: m.displayName,
    providerBrand: m.providerBrand,
    input: m.input,
    output: m.output,
    cacheRead: m.cacheRead,
    cacheCreation: m.cacheCreation,
    costInput: m.costInput,
    costOutput: m.costOutput,
    costCacheRead: m.costCacheRead,
    costCacheCreation: m.costCacheCreation,
    costUsd: m.costUsd,
  }))
  const height = Math.max(120, chartData.length * 36 + 24)
  return (
    <SizedChart height={height}>
      {({ width: cw, height: ch }) => (
        <BarChart width={cw} height={ch} data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barCategoryGap={6}>
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis
            type="category"
            dataKey="key"
            tick={<ModelAxisTick rows={chartData} />}
            tickLine={false}
            axisLine={false}
            width={220}
          />
          <Tooltip
            cursor={{ fill: 'var(--accent)', opacity: 0.3 }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null
              const modelRow = payload[0]?.payload as (typeof chartData)[number] | undefined
              const values: Record<TokenTypeKey, number> = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
              const costs: Record<TokenTypeKey, number> = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
              if (modelRow) {
                for (const k of TOKEN_TYPE_KEYS) {
                  values[k] = modelRow[k]
                  costs[k] = modelRow[TOKEN_TYPE_COST_KEYS[k] as keyof typeof modelRow] as number
                }
              }
              const total = values.input + values.output + values.cacheRead + values.cacheCreation
              const priced = modelRow?.costUsd != null
              return (
                <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                  {modelRow && (
                    <div className="mb-1 flex items-center gap-1.5 font-medium" title={modelRow.model}>
                      <ModelGlyph modelId={modelRow.model} providerBrand={modelRow.providerBrand} size={16} />
                      <span>{modelRow.displayName}</span>
                    </div>
                  )}
                  {TOKEN_TYPE_KEYS.map((k) => (
                    <TooltipRow
                      key={k}
                      color={TOKEN_TYPE_COLORS[k].fill}
                      opacity={TOKEN_TYPE_COLORS[k].opacity}
                      label={t(`settings.usage.tokenTypes.${k}`)}
                      tokens={values[k]}
                      cost={priced ? costs[k] : undefined}
                    />
                  ))}
                  <TooltipRow
                    color="transparent"
                    label={t('settings.usage.tooltip.total')}
                    tokens={total}
                    cost={priced ? modelRow.costUsd! : undefined}
                    bold
                  />
                </div>
              )
            }}
          />
          {TOKEN_TYPE_KEYS.map((key, idx) => (
            <Bar
              key={key}
              dataKey={key}
              name={key}
              stackId="tokens"
              fill={TOKEN_TYPE_COLORS[key].fill}
              fillOpacity={TOKEN_TYPE_COLORS[key].opacity}
              radius={idx === 0 ? [4, 0, 0, 4] : idx === TOKEN_TYPE_KEYS.length - 1 ? [0, 4, 4, 0] : [0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      )}
    </SizedChart>
  )
}

function ModelAxisTick({
  x = 0,
  y = 0,
  payload,
  rows,
}: {
  x?: number
  y?: number
  payload?: { value?: string }
  rows: Array<{ key: string; model: string; displayName: string; providerBrand: string }>
}) {
  const row = rows.find((item) => item.key === payload?.value)
  if (!row) return null
  return (
    <foreignObject x={x - 216} y={y - 11} width={208} height={22}>
      <div className="flex h-full min-w-0 items-center justify-end gap-1.5 text-[11px] text-muted-foreground" title={row.model}>
        <span className="flex size-4 shrink-0 items-center justify-center">
          <ModelGlyph modelId={row.model} providerBrand={row.providerBrand} size={15} />
        </span>
        <span className="truncate">{row.displayName}</span>
      </div>
    </foreignObject>
  )
}

function DailyHarnessChart({ data, t, showTopLabels }: { data: DailyHarnessRow[]; t: (key: string) => string; showTopLabels?: boolean }) {
  const totals = data.map((d) => d.claude + d.codex + d.grok)
  const positives = totals.filter((v) => v > 0)
  const avg = positives.length > 0 ? positives.reduce((a, b) => a + b, 0) / positives.length : 0
  return (
    <SizedChart height={240}>
      {({ width: cw, height: ch }) => (
        <BarChart width={cw} height={ch} data={data} margin={{ top: showTopLabels ? 24 : 8, right: 8, left: 8, bottom: 4 }} barCategoryGap={showTopLabels ? 12 : 4}>
          <defs>
            <linearGradient id="barClaude" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={1} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.7} />
            </linearGradient>
            <linearGradient id="barCodex" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--foreground)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--foreground)" stopOpacity={0.25} />
            </linearGradient>
            <linearGradient id="barGrok" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--warning)" stopOpacity={0.85} />
              <stop offset="100%" stopColor="var(--warning)" stopOpacity={0.45} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={32}
          />
          <YAxis hide domain={[0, 'dataMax']} />
          {avg > 0 && (
            <ReferenceLine
              y={avg}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              strokeOpacity={0.6}
              label={{
                value: `${t('settings.usage.tooltip.avg')} ${formatNumber(Math.round(avg))}`,
                position: 'insideTopRight',
                fill: 'var(--muted-foreground)',
                fontSize: 10,
              }}
            />
          )}
          <Tooltip
            cursor={{ fill: 'var(--accent)', opacity: 0.3 }}
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null
              const row = payload[0]?.payload as DailyHarnessRow | undefined
              const claude = row?.claude ?? 0
              const codex = row?.codex ?? 0
              const grok = row?.grok ?? 0
              return (
                <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                  <div className="mb-1 font-medium">{label}</div>
                  <TooltipRow color="var(--primary)" label="Claude" tokens={claude} cost={row?.claudeCost ?? 0} />
                  <TooltipRow color="var(--foreground)" opacity={0.4} label="Codex" tokens={codex} cost={row?.codexCost ?? 0} />
                  <TooltipRow color="var(--warning)" opacity={0.75} label="Grok" tokens={grok} cost={row?.grokCost ?? 0} />
                  <TooltipRow
                    color="transparent"
                    label={t('settings.usage.tooltip.total')}
                    tokens={claude + codex + grok}
                    cost={(row?.claudeCost ?? 0) + (row?.codexCost ?? 0) + (row?.grokCost ?? 0)}
                    bold
                  />
                </div>
              )
            }}
          />
          <Bar dataKey="claude" name="Claude" fill="url(#barClaude)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="codex" name="Codex" fill="url(#barCodex)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="grok" name="Grok" fill="url(#barGrok)" radius={[3, 3, 0, 0]}>
            {showTopLabels && (
              <LabelList
                dataKey={(entry: DailyHarnessRow) => entry.claude + entry.codex + entry.grok}
                position="top"
                formatter={(v) => typeof v === 'number' && v > 0 ? formatNumber(v) : ''}
                style={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              />
            )}
          </Bar>
        </BarChart>
      )}
    </SizedChart>
  )
}

function DailyTokenTypeChart({ data, t, showTopLabels }: { data: DailyTokenTypeRow[]; t: (key: string) => string; showTopLabels?: boolean }) {
  const totals = data.map((d) => d.input + d.output + d.cacheRead + d.cacheCreation)
  const positives = totals.filter((v) => v > 0)
  const avg = positives.length > 0 ? positives.reduce((a, b) => a + b, 0) / positives.length : 0
  return (
    <SizedChart height={240}>
      {({ width: cw, height: ch }) => (
        <BarChart width={cw} height={ch} data={data} margin={{ top: showTopLabels ? 24 : 8, right: 8, left: 8, bottom: 4 }} barCategoryGap={showTopLabels ? 16 : 2}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={32}
          />
          <YAxis hide domain={[0, 'dataMax']} />
          {avg > 0 && (
            <ReferenceLine
              y={avg}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              strokeOpacity={0.6}
              label={{
                value: `${t('settings.usage.tooltip.avg')} ${formatNumber(Math.round(avg))}`,
                position: 'insideTopRight',
                fill: 'var(--muted-foreground)',
                fontSize: 10,
              }}
            />
          )}
          <Tooltip
            cursor={{ fill: 'var(--accent)', opacity: 0.3 }}
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null
              const row = payload[0]?.payload as DailyTokenTypeRow | undefined
              const values: Record<TokenTypeKey, number> = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
              const costs: Record<TokenTypeKey, number> = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
              for (const k of TOKEN_TYPE_KEYS) {
                values[k] = row?.[k] ?? 0
                costs[k] = (row?.[TOKEN_TYPE_COST_KEYS[k]] as number | undefined) ?? 0
              }
              const total = values.input + values.output + values.cacheRead + values.cacheCreation
              const totalCost = costs.input + costs.output + costs.cacheRead + costs.cacheCreation
              return (
                <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                  <div className="mb-1 font-medium">{label}</div>
                  {TOKEN_TYPE_KEYS.map((k) => (
                    <TooltipRow
                      key={k}
                      color={TOKEN_TYPE_COLORS[k].fill}
                      opacity={TOKEN_TYPE_COLORS[k].opacity}
                      label={t(`settings.usage.tokenTypes.${k}`)}
                      tokens={values[k]}
                      cost={costs[k]}
                    />
                  ))}
                  <TooltipRow color="transparent" label={t('settings.usage.tooltip.total')} tokens={total} cost={totalCost} bold />
                </div>
              )
            }}
          />
          {TOKEN_TYPE_KEYS.map((key, idx) => {
            const isTop = idx === TOKEN_TYPE_KEYS.length - 1
            return (
              <Bar
                key={key}
                dataKey={key}
                name={key}
                stackId="tokens"
                fill={TOKEN_TYPE_COLORS[key].fill}
                fillOpacity={TOKEN_TYPE_COLORS[key].opacity}
                radius={isTop ? [3, 3, 0, 0] : [0, 0, 0, 0]}
              >
                {isTop && showTopLabels && (
                  <LabelList
                    dataKey={(entry: DailyTokenTypeRow) => entry.input + entry.output + entry.cacheRead + entry.cacheCreation}
                    position="top"
                    formatter={(v) => typeof v === 'number' && v > 0 ? formatNumber(v) : ''}
                    style={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                  />
                )}
              </Bar>
            )
          })}
        </BarChart>
      )}
    </SizedChart>
  )
}

function TooltipRow({
  color,
  opacity = 1,
  label,
  tokens,
  cost,
  bold,
}: {
  color: string
  opacity?: number
  label: string
  tokens: number
  cost?: number
  bold?: boolean
}) {
  return (
    <div className={cn('flex items-center gap-2', bold && 'mt-1 border-t border-border pt-1 font-medium')}>
      <span className="size-2 rounded-sm" style={{ backgroundColor: color, opacity }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto flex items-center gap-1.5 tabular-nums">
        <span>{formatNumber(tokens)}</span>
        {cost != null && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span className="text-muted-foreground">{formatUsd(cost)}</span>
          </>
        )}
      </span>
    </div>
  )
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-[11px] leading-snug text-muted-foreground/80">{hint}</div> : null}
    </div>
  )
}

function LegendDot({ fill, opacity = 1, label }: { fill: string; opacity?: number; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2 rounded-sm" style={{ backgroundColor: fill, opacity }} />
      <span>{label}</span>
    </span>
  )
}
