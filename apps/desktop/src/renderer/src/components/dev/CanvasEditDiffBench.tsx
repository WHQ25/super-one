import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  advanceAnimations,
  buildDisplayLines,
  greedyLineDiff,
  IDLE_FRAME_MS,
  reconcileLines,
  renderFrame,
  type AnimatedLine,
} from '../chat/CanvasEditDiff'
import {
  ActiveBadge,
  BenchResultTable,
  LiveReadout,
  RunButton,
  SAMPLE_COUNT,
  Seg,
  useBenchRunner,
  useLiveMetrics,
  useWindowActive,
} from './bench-ui'

type Strategy = 'static' | 'continuous' | 'idle'

const STRATEGIES: { key: Strategy; label: string }[] = [
  { key: 'static', label: '静止基线' },
  { key: 'continuous', label: '旧:常驻 rAF' },
  { key: 'idle', label: '新:idle 节流+可见性门控' },
]
const RUN_ORDER: Strategy[] = ['static', 'continuous', 'idle']

const BASE_LINES = [
  'export function reduceTool(session, event) {',
  '  const previews = session._streamingToolInputPreviews',
  '  const raw = streamingToolInputRaw.get(event.toolUseId)',
  '  const nextRaw = (raw ?? "") + event.partialJson',
  '  streamingToolInputRaw.set(event.toolUseId, nextRaw)',
  '  const now = Date.now()',
  '  const hasPrev = !!previews[event.toolUseId]',
  '  const lastUpdate = streamingPreviewLastUpdate.get(event.toolUseId) ?? 0',
  '  const shouldExtract = !hasPrev || (now - lastUpdate) >= THROTTLE_MS',
  '  if (!shouldExtract) return { lastEventAt: now }',
  '  const parsed = tryParsePartialJson(nextRaw)',
  '  streamingPreviewLastUpdate.set(event.toolUseId, now)',
  '  return { _streamingToolInputPreviews: { ...previews, [id]: parsed } }',
  '}',
]

function makeDiff(seed: number): { oldLines: string[]; newLines: string[] } {
  const oldLines = BASE_LINES.slice()
  const newLines = BASE_LINES.slice()
  const a = seed % oldLines.length
  const b = (seed * 7 + 3) % oldLines.length
  newLines[a] = `  // touched@${seed}: ${oldLines[a].trim()}`
  newLines.splice(b, 0, `  const injected_${seed} = computeExtra(${seed})`)
  return { oldLines, newLines }
}

function buildSettledLines(seed: number): AnimatedLine[] {
  const { oldLines, newLines } = makeDiff(seed)
  const events = greedyLineDiff(oldLines, newLines, true)
  const display = buildDisplayLines(events, oldLines, null, null)
  const lines = reconcileLines([], display)
  for (const l of lines) l.textCharsShown = l.textCharsTarget
  return lines
}

const Cell = memo(function Cell({ strategy, seed, isDark }: { strategy: Strategy; seed: number; isDark: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const linesRef = useRef<AnimatedLine[]>([])
  linesRef.current = useMemo(() => buildSettledLines(seed), [seed])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const lines = linesRef.current

    if (strategy === 'static') {
      renderFrame(canvas, container, lines, performance.now(), isDark, false)
      return
    }

    let rafId = 0
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let visible = true
    let last = performance.now()

    const hasBacklog = (): boolean => {
      for (const l of lines) if (l.textCharsShown < l.textCharsTarget) return true
      return false
    }
    const tick = (now: number): void => {
      const dt = Math.min(64, now - last)
      last = now
      advanceAnimations(lines, dt)
      renderFrame(canvas, container, lines, now, isDark, false)
      schedule()
    }
    const schedule = (): void => {
      if (!visible) return
      if (strategy === 'continuous') {
        rafId = requestAnimationFrame(tick)
      } else if (hasBacklog()) {
        rafId = requestAnimationFrame(tick)
      } else {
        idleTimer = setTimeout(() => { rafId = requestAnimationFrame(tick) }, IDLE_FRAME_MS)
      }
    }
    const stop = (): void => {
      cancelAnimationFrame(rafId)
      clearTimeout(idleTimer)
    }

    let observer: IntersectionObserver | undefined
    if (strategy === 'idle') {
      observer = new IntersectionObserver((entries) => {
        const next = entries[entries.length - 1]?.isIntersecting ?? true
        if (next === visible) return
        visible = next
        stop()
        if (visible) {
          last = performance.now()
          rafId = requestAnimationFrame(tick)
        }
      })
      observer.observe(container)
    }

    rafId = requestAnimationFrame(tick)
    return () => {
      stop()
      observer?.disconnect()
    }
  }, [strategy, isDark])

  return (
    <div
      ref={containerRef}
      style={{
        borderRadius: 6,
        border: '1px solid color-mix(in oklab, currentColor 12%, transparent)',
        overflow: 'hidden',
        maxHeight: 220,
        width: 340,
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  )
})

export function CanvasEditDiffBench() {
  const [strategy, setStrategy] = useState<Strategy>('continuous')
  const [count, setCount] = useState(12)
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  const active = useWindowActive()
  const { rows, running, phase, run } = useBenchRunner<Strategy>()
  const { hasApi, live, selfPid } = useLiveMetrics(running)

  const runBenchmark = useCallback(() => {
    if (!hasApi) return
    void run(RUN_ORDER, setStrategy, () => 1500)
  }, [hasApi, run])

  return (
    <div style={{ font: '13px/1.5 -apple-system, system-ui, sans-serif', padding: 16 }}>
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
        <Seg
          label="策略"
          value={strategy}
          options={STRATEGIES.map((s) => [s.key, s.label] as [string, string])}
          onChange={(v) => !running && setStrategy(v as Strategy)}
        />
        <Seg
          label="外观"
          value={dark ? 'dark' : 'light'}
          options={[['light', '亮色'], ['dark', '暗色']] as [string, string][]}
          onChange={(v) => !running && setDark(v === 'dark')}
        />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          diff 块数 <input type="range" min={1} max={60} value={count} onChange={(e) => setCount(+e.target.value)} />
          <b style={{ fontVariantNumeric: 'tabular-nums' }}>{count}</b>
        </label>
        <RunButton running={running} phase={phase} disabled={running || !hasApi} onClick={runBenchmark} />
      </div>

      {!hasApi && (
        <div style={{ color: '#ef4444', marginBottom: 12 }}>
          window.app.getAppMetrics 不可用 —— 此页需在 dev 模式下、由主程序快捷键 ⌘/Ctrl+⌥+B 打开的 bench 窗口中运行。
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <ActiveBadge active={active} />
        <LiveReadout live={live} selfPid={selfPid} />
      </div>

      <BenchResultTable
        rows={rows}
        baselineKey="static"
        labelOf={(s) => STRATEGIES.find((x) => x.key === s)?.label ?? s}
      />

      <div style={{ opacity: 0.55, fontSize: 12, margin: '4px 0 12px' }}>
        对比 Edit/Write 工具的 <b>CanvasEditDiff</b> 打字机 diff 在<b>已完成流式（稳态）</b>时的每实例循环开销。
        <b>旧:常驻 rAF</b>=diff 写完后 rAF 循环仍按刷新率常驻（ProMotion=120fps），只为让光标闪烁就每帧全画布重绘；长对话里 N 个已完成的 Edit 块各烧一条 120fps 循环。
        <b>新:idle 节流+可见性门控</b>=无打字积压时降到 setTimeout({IDLE_FRAME_MS}ms)≈20fps 的空闲节律，且 IntersectionObserver 在 diff 滚出视口时整条循环暂停。
        <b>静止基线</b>=同样的 diff 只画一帧、零循环（首帧后不再重绘，光标不闪）。真实使用规模是几个可见 Edit 块；块数放大只为让差异超出采样噪声，看 Δvs基线 的相对倍数即可。
        idleWakeups/s 是待机偷烧 CPU 的最灵敏指标。此 bench 只覆盖稳态循环这一项优化；另一项 tool.ts reducer 预览节流是流式期间的 React 重渲频率，稳态 getAppMetrics 口径测不到。
        跑批每档 settle 后采 {SAMPLE_COUNT} 次（丢首样）。所有 diff 块进入稳态（无打字积压），因此 <b>常驻 rAF</b> 全程满帧、<b>idle</b> 降到 20fps，正好隔离该优化。
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignContent: 'flex-start', padding: 12 }}>
        {Array.from({ length: count }, (_, i) => (
          <Cell key={`${strategy}-${dark}-${i}`} strategy={strategy} seed={i} isDark={dark} />
        ))}
      </div>
    </div>
  )
}
