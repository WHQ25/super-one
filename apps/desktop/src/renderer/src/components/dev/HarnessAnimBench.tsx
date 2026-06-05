import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ClaudeSessionIcon, type SessionIconProps } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { CodexSessionIcon } from '@superone/ui/components/harness/CodexSessionIcon'
import { SpriteSvg } from './SpriteSvg'
import { LegacyClaudeSessionIcon } from './legacy/LegacyClaudeSessionIcon'
import { LegacyCodexSessionIcon } from './legacy/LegacyCodexSessionIcon'
import { DivMascot, DIV_MASCOT_CSS } from './DivMascot'
import { ClaudeIdle, CodexIdle, VARIANT_CSS } from './variants/IdleVariants'
import { ClaudeIdleBenchIcon, CLAUDE_IDLE_BENCH_CSS } from './ClaudeIdleBenchIcon'
import { ClaudeBenchIcon, CLAUDE_BENCH_CSS } from './ClaudeBenchIcon'
import { CodexBenchIcon, CODEX_BENCH_CSS } from './CodexBenchIcon'
import { averageSamples, reduceSnapshot, sleep, type MetricSample } from './bench-metrics'

type Strategy = 'none' | 'svg-old' | 'svg' | 'svg-nc' | 'svg-out' | 'claude-idle-bench' | 'bench' | 'sprite' | 'div'
type Harness = 'claude' | 'codex'
type Status = SessionIconProps['status']

const STRATEGIES: { key: Strategy; label: string }[] = [
  { key: 'none', label: '静止基线' },
  { key: 'svg-old', label: 'SVG 旧版(height)' },
  { key: 'svg', label: 'SVG 新版(transform)' },
  { key: 'svg-nc', label: 'SVG 去crisp' },
  { key: 'svg-out', label: 'SVG 外层float' },
  { key: 'claude-idle-bench', label: 'Claude idle 实验' },
  { key: 'bench', label: '便宜版(全状态)' },
  { key: 'sprite', label: 'Sprite' },
  { key: 'div', label: 'DIV+CSS' },
]
const STATUSES: Status[] = ['default', 'running', 'background', 'unseen', 'automation']
const HARNESSES: Harness[] = ['claude', 'codex']
const VARIANTS: { harness: Harness; status: Status }[] = HARNESSES.flatMap((h) =>
  STATUSES.map((s) => ({ harness: h, status: s })),
)
type Scene = 'single' | 'mix'
const RUN_ORDER: Strategy[] = ['none', 'svg-old', 'svg', 'svg-nc', 'svg-out', 'claude-idle-bench', 'bench', 'div', 'sprite']
const SAMPLE_COUNT = 6
const SAMPLE_INTERVAL_MS = 1000

function Icon({ harness, status, size, legacy }: { harness: Harness; status: Status; size: number; legacy?: boolean }) {
  if (legacy) {
    return harness === 'claude' ? (
      <LegacyClaudeSessionIcon status={status} size={size} />
    ) : (
      <LegacyCodexSessionIcon status={status} size={size} />
    )
  }
  return harness === 'claude' ? (
    <ClaudeSessionIcon status={status} size={size} />
  ) : (
    <CodexSessionIcon status={status} size={size} />
  )
}

const Cell = memo(function Cell({
  strategy,
  harness,
  status,
  size,
}: {
  strategy: Strategy
  harness: Harness
  status: Status
  size: number
}) {
  const box: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    outline: '1px solid color-mix(in oklab, currentColor 12%, transparent)',
  }
  if (strategy === 'none') return <span style={{ ...box, background: '#E07B4A' }} />
  if (strategy === 'div') return <span style={box}><DivMascot size={size} /></span>
  if (strategy === 'svg-old') return <span style={box}><Icon harness={harness} status={status} size={size} legacy /></span>
  if (strategy === 'claude-idle-bench') return <span style={box}><ClaudeIdleBenchIcon size={size} /></span>
  if (strategy === 'bench')
    return (
      <span style={box}>
        {harness === 'claude' ? (
          <ClaudeBenchIcon status={status} size={size} />
        ) : (
          <CodexBenchIcon status={status} size={size} />
        )}
      </span>
    )
  if (strategy === 'svg-nc' || strategy === 'svg-out') {
    const outerFloat = strategy === 'svg-out'
    return (
      <span style={box}>
        {harness === 'claude' ? (
          <ClaudeIdle size={size} crispEdges={false} outerFloat={outerFloat} />
        ) : (
          <CodexIdle size={size} crispEdges={false} outerFloat={outerFloat} />
        )}
      </span>
    )
  }
  if (strategy === 'sprite')
    return (
      <span style={box}>
        <SpriteSvg cacheKey={`${harness}-${status}-${size}`} width={size} height={size}>
          <Icon harness={harness} status={status} size={size} />
        </SpriteSvg>
      </span>
    )
  return <span style={box}><Icon harness={harness} status={status} size={size} /></span>
})

const BenchGrid = memo(function BenchGrid({
  scene,
  strategy,
  harness,
  status,
  size,
  count,
}: {
  scene: Scene
  strategy: Strategy
  harness: Harness
  status: Status
  size: number
  count: number
}) {
  const cells =
    scene === 'mix'
      ? VARIANTS.flatMap((v) =>
          Array.from({ length: count }, (_, i) => ({ key: `${v.harness}-${v.status}-${i}`, ...v })),
        )
      : Array.from({ length: count }, (_, i) => ({ key: `${i}`, harness, status }))
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignContent: 'flex-start', padding: 12 }}>
      {cells.map((c) => (
        <Cell key={c.key} strategy={strategy} harness={c.harness} status={c.status} size={size} />
      ))}
    </div>
  )
})

interface BenchRow {
  strategy: Strategy
  avg: MetricSample
}

const num = (n: number, d = 1) => n.toFixed(d)

export function HarnessAnimBench() {
  const [scene, setScene] = useState<Scene>('mix')
  const [strategy, setStrategy] = useState<Strategy>('svg')
  const [harness, setHarness] = useState<Harness>('claude')
  const [status, setStatus] = useState<Status>('default')
  const [count, setCount] = useState(20)
  const [size, setSize] = useState(16)
  const countMax = 50
  const countMin = 1
  const total = scene === 'mix' ? count * VARIANTS.length : count

  const switchScene = useCallback((next: Scene) => {
    setScene(next)
    setCount(next === 'mix' ? 20 : 50)
  }, [])
  const [live, setLive] = useState<MetricSample | null>(null)
  const [selfPid, setSelfPid] = useState<number | null>(null)
  const [rows, setRows] = useState<BenchRow[]>([])
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<string>('')
  const [active, setActive] = useState(true)
  const runningRef = useRef(false)

  const hasApi = typeof window !== 'undefined' && typeof window.app?.getAppMetrics === 'function'

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

  useEffect(() => {
    if (!hasApi || running) return
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
  }, [hasApi, running])

  const runBenchmark = useCallback(async () => {
    if (!hasApi || runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setRows([])
    const collected: BenchRow[] = []
    try {
      for (const strat of RUN_ORDER) {
        setStrategy(strat)
        setPhase(`${strat} · settling…`)
        await sleep(strat === 'sprite' ? (scene === 'mix' ? 5000 : 3000) : 1500)
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
  }, [hasApi, scene])

  const baseline = rows.find((r) => r.strategy === 'none')?.avg
  const delta = (v: number, base: number | undefined) =>
    base === undefined ? '' : `${v - base >= 0 ? '+' : ''}${num(v - base)}`

  return (
    <div style={{ font: '13px/1.5 -apple-system, system-ui, sans-serif', padding: 16 }}>
      <style>{DIV_MASCOT_CSS}{VARIANT_CSS}{CLAUDE_IDLE_BENCH_CSS}{CLAUDE_BENCH_CSS}{CODEX_BENCH_CSS}</style>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'center',
          padding: '12px 16px',
          border: '1px solid color-mix(in oklab, currentColor 12%, transparent)',
          borderRadius: 12,
          marginBottom: 12,
          position: 'sticky',
          top: 8,
          background: 'var(--background)',
          zIndex: 10,
        }}
      >
        <Seg label="场景" value={scene} options={[['mix', '混合现实'], ['single', '单一']] as [string, string][]} onChange={(v) => !running && switchScene(v as Scene)} />
        <Seg label="策略" value={strategy} options={STRATEGIES.map((s) => [s.key, s.label] as [string, string])} onChange={(v) => !running && setStrategy(v as Strategy)} />
        {scene === 'single' && (
          <>
            <Seg label="Harness" value={harness} options={[['claude', 'Claude'], ['codex', 'Codex']] as [string, string][]} onChange={(v) => setHarness(v as Harness)} />
            <Seg label="状态" value={status} options={STATUSES.map((s) => [s, s] as [string, string])} onChange={(v) => setStatus(v as Status)} />
          </>
        )}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {scene === 'mix' ? '每种×' : '数量'}{' '}
          <input type="range" min={countMin} max={countMax} value={count} onChange={(e) => setCount(+e.target.value)} />
          <b style={{ fontVariantNumeric: 'tabular-nums' }}>{count}</b>
          {scene === 'mix' && <span style={{ opacity: 0.5 }}>= {total}个</span>}
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          尺寸 <input type="range" min={12} max={64} value={size} onChange={(e) => setSize(+e.target.value)} />
          <b style={{ fontVariantNumeric: 'tabular-nums' }}>{size}px</b>
        </label>
        <button
          onClick={runBenchmark}
          disabled={running || !hasApi}
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
      </div>

      {!hasApi && (
        <div style={{ color: '#ef4444', marginBottom: 12 }}>
          window.app.getAppMetrics 不可用 —— 此页需在 dev 模式下、由主程序快捷键 ⌘/Ctrl+⌥+B 打开的 bench 窗口中运行。
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
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
        <LiveReadout live={live} selfPid={selfPid} />
      </div>

      {rows.length > 0 && (
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
              const isBase = r.strategy === 'none'
              return (
                <tr key={r.strategy} style={{ textAlign: 'right', borderTop: '1px solid color-mix(in oklab, currentColor 10%, transparent)' }}>
                  <td style={{ textAlign: 'left', padding: 4, fontWeight: 600 }}>
                    {STRATEGIES.find((s) => s.key === r.strategy)?.label}
                  </td>
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
      )}

      <div style={{ opacity: 0.55, fontSize: 12, margin: '4px 0 12px' }}>
        CPU% 已按逻辑 CPU 数从 Electron getAppMetrics 口径换算为 Activity Monitor 口径（单核=100，可超 100）。GPU 列含主窗口背景占用，<b>看 Δvs基线</b> 才是该策略净增量。
        RSS=workingSetSize（含共享框架页），比 Activity Monitor「内存」(phys_footprint) 大 2–3x 属正常，mac 上该值本就不精确——只看相对 Δ。detached DevTools 是另一个 renderer 进程，按上方 pid 对行。
        idleWakeups/s 是待机偷烧 CPU 的最灵敏指标。跑批顺序：基线→SVG旧→SVG新→DIV→Sprite，每档 settle 后采 {SAMPLE_COUNT} 次（丢首样）。SVG旧=动 height(几何重绘)，SVG新=动 transform。
        {scene === 'mix' && ` 混合现实=全部 ${VARIANTS.length} 个变体(2 harness×5 状态)各 ${count} 份，共 ${total} 个。`}
        {' '}SVG去crisp=去掉 shapeRendering(每帧重栅格嫌疑)；SVG外层float=整体浮动/缩放移到外层 HTML transform+will-change(真合成)，仅眨眼/腿摆留 SVG 内部。这两档恒为 idle/default 形态(对标主页 hero)，与 status 选择无关。Claude idle 实验=单独 bench 文件，静态腿部+外层 HTML 位移+眼睛 opacity。
        {' '}<b>便宜版(全状态)</b>=把 idle 那套便宜思路推广到所有状态：整体运动(float/bob/jump/scale/rotate)全部移到外层 HTML transform+will-change(真合成层)，眨眼/呼吸/键闪/光标改 opacity(键闪由 fill 动画改为双色层 opacity 切换)，几何形变腿用 transform:scaleY；Codex running 云朵转、光标作静止 overlay 叠在上层。随 mix 场景全变体对照 svg 新版。
      </div>

      <BenchGrid scene={scene} strategy={strategy} harness={harness} status={status} size={size} count={count} />
    </div>
  )
}

function Metric({ value, delta }: { value: string; delta: string }) {
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

function LiveReadout({ live, selfPid }: { live: MetricSample | null; selfPid: number | null }) {
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

function Seg({
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
