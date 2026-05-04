import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '@/lib/utils'

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
    <div ref={ref} style={{ height: heightStyle, minWidth: 0 }} className={cn('w-full', className)}>
      {size.width > 0 && size.height > 0 ? children(size) : null}
    </div>
  )
}

type Harness = 'claude' | 'codex'
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

type RangePreset = 'today' | '7d' | '30d' | '90d' | 'all'

const PRESETS: { id: RangePreset; days: number | null }[] = [
  { id: 'today', days: 1 },
  { id: '7d', days: 7 },
  { id: '30d', days: 30 },
  { id: '90d', days: 90 },
  { id: 'all', days: null },
]

const HARNESS_FILTERS: HarnessFilter[] = ['all', 'claude', 'codex']

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

export function UsagePage() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<UsageRow[]>([])
  const [counts, setCounts] = useState<{ sessions: number; messages: number }>({ sessions: 0, messages: 0 })
  const [loading, setLoading] = useState(true)
  const [backfilling, setBackfilling] = useState(false)
  const [preset, setPreset] = useState<RangePreset>('today')
  const [harnessFilter, setHarnessFilter] = useState<HarnessFilter>('all')

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
    } finally {
      setLoading(false)
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

  const dailyByHarness = useMemo(() => {
    const byDay = new Map<string, { claude: number; codex: number }>()
    for (const r of rows) {
      const cur = byDay.get(r.day) ?? { claude: 0, codex: 0 }
      const tokens = rowTotal(r)
      if (r.harness === 'claude') cur.claude += tokens
      else cur.codex += tokens
      byDay.set(r.day, cur)
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a < b ? -1 : 1)
      .map(([day, v]) => ({ day, claude: v.claude, codex: v.codex }))
  }, [rows])

  const dailyByTokenType = useMemo(() => {
    const byDay = new Map<string, { input: number; output: number; cacheRead: number; cacheCreation: number }>()
    for (const r of filteredRows) {
      const cur = byDay.get(r.day) ?? { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
      cur.input += r.input_tokens
      cur.output += r.output_tokens
      cur.cacheRead += r.cache_read_tokens
      cur.cacheCreation += r.cache_creation_tokens
      byDay.set(r.day, cur)
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a < b ? -1 : 1)
      .map(([day, v]) => ({ day, ...v }))
  }, [filteredRows])

  const byModel = useMemo(() => {
    const map = new Map<string, { harness: Harness; model: string; input: number; output: number; cacheRead: number; cacheCreation: number }>()
    for (const r of filteredRows) {
      const key = `${r.harness}::${r.model}`
      const cur = map.get(key) ?? { harness: r.harness, model: r.model, input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
      cur.input += r.input_tokens
      cur.output += r.output_tokens
      cur.cacheRead += r.cache_read_tokens
      cur.cacheCreation += r.cache_creation_tokens
      map.set(key, cur)
    }
    return Array.from(map.values()).sort((a, b) => (b.input + b.output + b.cacheRead + b.cacheCreation) - (a.input + a.output + a.cacheRead + a.cacheCreation))
  }, [filteredRows])

  const isAll = harnessFilter === 'all'
  const isToday = preset === 'today'
  const isHeatmap = preset === 'all'
  const isAreaRange = preset === '90d'
  const dayTotalsMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of filteredRows) {
      m.set(r.day, (m.get(r.day) ?? 0) + rowTotal(r))
    }
    return m
  }, [filteredRows])
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard label={t('settings.usage.summary.totalTokens')} value={formatNumber(filteredTokenTotal)} />
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
              </tr>
            </thead>
            <tbody>
              {byModel.map((m) => {
                const total = m.input + m.output + m.cacheRead + m.cacheCreation
                return (
                  <tr key={`${m.harness}::${m.model}`} className="border-b border-border/50 last:border-b-0">
                    <td className="px-4 py-2 font-mono text-xs">{m.model}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatNumber(m.input)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatNumber(m.output)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatNumber(m.cacheRead)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatNumber(m.cacheCreation)}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatNumber(total)}</td>
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

function ContributionHeatmap({ dayTotals, t }: { dayTotals: Map<string, number>; t: (key: string) => string }) {
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

  const thresholds = computeHeatmapThresholds(Array.from(dayTotals.values()))

  const cells: Array<{ x: number; y: number; level: number; date: string; value: number }> = []
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
      const value = dayTotals.get(key) ?? 0
      cells.push({
        x: dayLabelWidth + col * stride,
        y: monthLabelHeight + row * stride,
        level: intensityLevel(value, thresholds),
        date: key,
        value,
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

  const [hover, setHover] = useState<typeof cells[number] | null>(null)

  return (
    <div className="relative w-full overflow-x-auto">
      <svg width={width} height={height} className="overflow-visible">
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
            {hover.value > 0
              ? `${formatNumber(hover.value)} ${t('settings.usage.heatmap.tokens')}`
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

interface DailyHarnessRow { day: string; claude: number; codex: number }
interface DailyTokenTypeRow { day: string; input: number; output: number; cacheRead: number; cacheCreation: number }

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
              const claude = (payload.find((p) => p.dataKey === 'claude')?.value as number) ?? 0
              const codex = (payload.find((p) => p.dataKey === 'codex')?.value as number) ?? 0
              return (
                <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                  <div className="mb-1 font-medium">{label}</div>
                  <TooltipRow color="var(--primary)" label="Claude" value={claude} />
                  <TooltipRow color="var(--foreground)" opacity={0.4} label="Codex" value={codex} />
                  <TooltipRow color="transparent" label={t('settings.usage.tooltip.total')} value={claude + codex} bold />
                </div>
              )
            }}
          />
          <Area type="monotone" dataKey="codex" stackId="usage" stroke="var(--foreground)" strokeOpacity={0.4} strokeWidth={1.5} fill="url(#codexFill)" />
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
              const values: Record<TokenTypeKey, number> = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
              for (const k of TOKEN_TYPE_KEYS) {
                values[k] = (payload.find((p) => p.dataKey === k)?.value as number) ?? 0
              }
              const total = values.input + values.output + values.cacheRead + values.cacheCreation
              return (
                <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                  <div className="mb-1 font-medium">{label}</div>
                  {TOKEN_TYPE_KEYS.map((k) => (
                    <TooltipRow
                      key={k}
                      color={TOKEN_TYPE_COLORS[k].fill}
                      opacity={TOKEN_TYPE_COLORS[k].opacity}
                      label={t(`settings.usage.tokenTypes.${k}`)}
                      value={values[k]}
                    />
                  ))}
                  <TooltipRow color="transparent" label={t('settings.usage.tooltip.total')} value={total} bold />
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
interface ByModelRow { harness: Harness; model: string; input: number; output: number; cacheRead: number; cacheCreation: number }

function TodayByModelChart({ data, t }: { data: ByModelRow[]; t: (key: string) => string }) {
  const chartData = data.map((m) => ({
    label: `${m.harness} · ${m.model}`,
    input: m.input,
    output: m.output,
    cacheRead: m.cacheRead,
    cacheCreation: m.cacheCreation,
  }))
  const height = Math.max(120, chartData.length * 36 + 24)
  return (
    <SizedChart height={height}>
      {({ width: cw, height: ch }) => (
        <BarChart width={cw} height={ch} data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barCategoryGap={6}>
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            width={220}
          />
          <Tooltip
            cursor={{ fill: 'var(--accent)', opacity: 0.3 }}
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null
              const values: Record<TokenTypeKey, number> = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
              for (const k of TOKEN_TYPE_KEYS) {
                values[k] = (payload.find((p) => p.dataKey === k)?.value as number) ?? 0
              }
              const total = values.input + values.output + values.cacheRead + values.cacheCreation
              return (
                <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                  <div className="mb-1 font-medium">{label}</div>
                  {TOKEN_TYPE_KEYS.map((k) => (
                    <TooltipRow
                      key={k}
                      color={TOKEN_TYPE_COLORS[k].fill}
                      opacity={TOKEN_TYPE_COLORS[k].opacity}
                      label={t(`settings.usage.tokenTypes.${k}`)}
                      value={values[k]}
                    />
                  ))}
                  <TooltipRow color="transparent" label={t('settings.usage.tooltip.total')} value={total} bold />
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

function DailyHarnessChart({ data, t, showTopLabels }: { data: DailyHarnessRow[]; t: (key: string) => string; showTopLabels?: boolean }) {
  const totals = data.map((d) => d.claude + d.codex)
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
              const claude = (payload.find((p) => p.dataKey === 'claude')?.value as number) ?? 0
              const codex = (payload.find((p) => p.dataKey === 'codex')?.value as number) ?? 0
              return (
                <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                  <div className="mb-1 font-medium">{label}</div>
                  <TooltipRow color="var(--primary)" label="Claude" value={claude} />
                  <TooltipRow color="var(--foreground)" opacity={0.4} label="Codex" value={codex} />
                  <TooltipRow color="transparent" label={t('settings.usage.tooltip.total')} value={claude + codex} bold />
                </div>
              )
            }}
          />
          <Bar dataKey="claude" name="Claude" fill="url(#barClaude)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="codex" name="Codex" fill="url(#barCodex)" radius={[3, 3, 0, 0]}>
            {showTopLabels && (
              <LabelList
                dataKey={(entry: DailyHarnessRow) => entry.claude + entry.codex}
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
              const values: Record<TokenTypeKey, number> = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
              for (const k of TOKEN_TYPE_KEYS) {
                values[k] = (payload.find((p) => p.dataKey === k)?.value as number) ?? 0
              }
              const total = values.input + values.output + values.cacheRead + values.cacheCreation
              return (
                <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                  <div className="mb-1 font-medium">{label}</div>
                  {TOKEN_TYPE_KEYS.map((k) => (
                    <TooltipRow
                      key={k}
                      color={TOKEN_TYPE_COLORS[k].fill}
                      opacity={TOKEN_TYPE_COLORS[k].opacity}
                      label={t(`settings.usage.tokenTypes.${k}`)}
                      value={values[k]}
                    />
                  ))}
                  <TooltipRow color="transparent" label={t('settings.usage.tooltip.total')} value={total} bold />
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

function TooltipRow({ color, opacity = 1, label, value, bold }: { color: string; opacity?: number; label: string; value: number; bold?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2', bold && 'mt-1 border-t border-border pt-1 font-medium')}>
      <span className="size-2 rounded-sm" style={{ backgroundColor: color, opacity }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto tabular-nums">{formatNumber(value)}</span>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
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
