import { useCallback, useEffect, useRef, useState } from 'react'
import { averageSamples, reduceSnapshot, sleep, type MetricSample } from './bench-metrics'

export const SAMPLE_COUNT = 6
export const SAMPLE_INTERVAL_MS = 1000

export const num = (n: number, d = 1): string => n.toFixed(d)

export interface BenchRow<S extends string> {
  strategy: S
  avg: MetricSample
}

export function useWindowActive(): boolean {
  const [active, setActive] = useState(true)
  useEffect(() => {
    const update = () => setActive(document.visibilityState === 'visible' && document.hasFocus())
    update()
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    return () => {
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
    }
  }, [])
  return active
}

export function useLiveMetrics(paused: boolean): {
  hasApi: boolean
  live: MetricSample | null
  selfPid: number | null
} {
  const [live, setLive] = useState<MetricSample | null>(null)
  const [selfPid, setSelfPid] = useState<number | null>(null)
  const hasApi = typeof window !== 'undefined' && typeof window.app?.getAppMetrics === 'function'

  useEffect(() => {
    if (!hasApi || paused) return
    let cancelled = false
    const id = setInterval(async () => {
      try {
        const snap = await window.app.getAppMetrics()
        if (!cancelled) {
          setLive(reduceSnapshot(snap))
          setSelfPid(snap.selfPid)
        }
      } catch {
        /* ignore */
      }
    }, SAMPLE_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [hasApi, paused])

  return { hasApi, live, selfPid }
}

export function useBenchRunner<S extends string>(): {
  rows: BenchRow<S>[]
  running: boolean
  phase: string
  run: (order: S[], apply: (s: S) => void, settleMs: (s: S) => number) => Promise<void>
} {
  const [rows, setRows] = useState<BenchRow<S>[]>([])
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState('')
  const runningRef = useRef(false)

  const run = useCallback(async (order: S[], apply: (s: S) => void, settleMs: (s: S) => number) => {
    if (runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setRows([])
    const collected: BenchRow<S>[] = []
    try {
      for (const strat of order) {
        apply(strat)
        setPhase(`${strat} · settling…`)
        await sleep(settleMs(strat))
        const samples: MetricSample[] = []
        for (let i = 0; i < SAMPLE_COUNT; i++) {
          setPhase(`${strat} · sampling ${i + 1}/${SAMPLE_COUNT}`)
          await sleep(SAMPLE_INTERVAL_MS)
          try {
            samples.push(reduceSnapshot(await window.app.getAppMetrics()))
          } catch {
            /* ignore */
          }
        }
        collected.push({ strategy: strat, avg: averageSamples(samples.slice(1)) })
        setRows([...collected])
      }
    } finally {
      runningRef.current = false
      setRunning(false)
      setPhase('')
    }
  }, [])

  return { rows, running, phase, run }
}

export function BenchResultTable<S extends string>({
  rows,
  baselineKey,
  labelOf,
}: {
  rows: BenchRow<S>[]
  baselineKey: S
  labelOf: (s: S) => string
}) {
  if (rows.length === 0) return null
  const baseline = rows.find((r) => r.strategy === baselineKey)?.avg
  const delta = (v: number, base: number | undefined) =>
    base === undefined ? '' : `${v - base >= 0 ? '+' : ''}${num(v - base)}`
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%', margin: '12px 0', fontVariantNumeric: 'tabular-nums' }}>
      <thead>
        <tr style={{ textAlign: 'right', opacity: 0.7 }}>
          <th style={{ textAlign: 'left', padding: 4 }}>策略</th>
          <th style={{ padding: 4 }}>renderer CPU%</th>
          <th style={{ padding: 4 }}>renderer 唤醒/s</th>
          <th style={{ padding: 4 }}>GPU CPU%</th>
          <th style={{ padding: 4 }}>GPU 唤醒/s</th>
          <th style={{ padding: 4 }}>renderer RSS·MB</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const isBase = r.strategy === baselineKey
          return (
            <tr key={r.strategy} style={{ textAlign: 'right', borderTop: '1px solid color-mix(in oklab, currentColor 10%, transparent)' }}>
              <td style={{ textAlign: 'left', padding: 4, fontWeight: 600 }}>{labelOf(r.strategy)}</td>
              <Metric value={num(r.avg.rendererCpu)} delta={isBase ? '' : delta(r.avg.rendererCpu, baseline?.rendererCpu)} />
              <Metric value={num(r.avg.rendererWakeups, 0)} delta={isBase ? '' : delta(r.avg.rendererWakeups, baseline?.rendererWakeups)} />
              <Metric value={num(r.avg.gpuCpu)} delta={isBase ? '' : delta(r.avg.gpuCpu, baseline?.gpuCpu)} />
              <Metric value={num(r.avg.gpuWakeups, 0)} delta={isBase ? '' : delta(r.avg.gpuWakeups, baseline?.gpuWakeups)} />
              <td style={{ padding: 4 }}>{num(r.avg.rendererMemMB, 0)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function Metric({ value, delta }: { value: string; delta: string }) {
  const down = delta.startsWith('-')
  return (
    <td style={{ padding: 4 }}>
      {value}
      {delta && (
        <span style={{ marginLeft: 6, fontSize: 11, color: down ? '#22c55e' : '#ef4444' }}>{delta}</span>
      )}
    </td>
  )
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 999,
        color: active ? '#16a34a' : '#dc2626',
        background: active ? '#16a34a22' : '#dc262622',
      }}
    >
      {active ? '● 窗口活跃（数据可信）' : '○ 窗口失焦/不可见 —— 已关 backgroundThrottling，仍建议保持前台'}
    </span>
  )
}

export function LiveReadout({ live, selfPid }: { live: MetricSample | null; selfPid: number | null }) {
  if (!live) return <div style={{ opacity: 0.5, marginBottom: 8 }}>等待 live 采样…</div>
  return (
    <div style={{ display: 'flex', gap: 20, marginBottom: 8, fontVariantNumeric: 'tabular-nums' }}>
      <span>renderer CPU <b>{num(live.rendererCpu)}%</b></span>
      <span>renderer 唤醒 <b>{num(live.rendererWakeups, 0)}/s</b></span>
      <span>GPU CPU <b>{num(live.gpuCpu)}%</b></span>
      <span>GPU 唤醒 <b>{num(live.gpuWakeups, 0)}/s</b></span>
      <span title="workingSetSize≈RSS，含共享页，比 Activity Monitor「内存」(footprint)大">renderer RSS <b>{num(live.rendererMemMB, 0)}MB</b></span>
      {selfPid !== null && <span style={{ opacity: 0.5 }}>pid {selfPid}</span>}
    </div>
  )
}

export function Seg({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: [string, string][]
  onChange: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        {options.map(([k, l]) => (
          <button
            key={k}
            onClick={() => onChange(k)}
            style={{
              font: 'inherit',
              padding: '5px 10px',
              borderRadius: 8,
              border: '1px solid color-mix(in oklab, currentColor 18%, transparent)',
              background: value === k ? 'var(--primary)' : 'transparent',
              color: value === k ? 'var(--primary-foreground)' : 'inherit',
              fontWeight: value === k ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}

export function RunButton({ running, phase, disabled, onClick }: {
  running: boolean
  phase: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        marginLeft: 'auto',
        font: 'inherit',
        fontWeight: 600,
        padding: '6px 14px',
        borderRadius: 8,
        border: 'none',
        background: running ? 'var(--muted)' : 'var(--primary)',
        color: running ? 'var(--muted-foreground)' : 'var(--primary-foreground)',
        cursor: running ? 'default' : 'pointer',
      }}
    >
      {running ? `跑批中… ${phase}` : '▶ 跑全策略基准'}
    </button>
  )
}
