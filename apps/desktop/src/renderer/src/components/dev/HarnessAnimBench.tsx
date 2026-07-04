import React, { memo, useCallback, useState } from 'react'
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
  const active = useWindowActive()
  const { rows, running, phase, run } = useBenchRunner<Strategy>()
  const { hasApi, live, selfPid } = useLiveMetrics(running)

  const runBenchmark = useCallback(() => {
    if (!hasApi) return
    void run(
      RUN_ORDER,
      setStrategy,
      (strat) => (strat === 'sprite' ? (scene === 'mix' ? 5000 : 3000) : 1500),
    )
  }, [hasApi, run, scene])

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
        baselineKey="none"
        labelOf={(s) => STRATEGIES.find((x) => x.key === s)?.label ?? s}
      />

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

