import { memo, useCallback, useEffect, useState } from 'react'
import { FireText, FireTextStatic } from '../chat/FireText'
import { FireTextLive } from './FireTextLive'
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

type Strategy = 'none' | 'live' | 'sprite'

const STRATEGIES: { key: Strategy; label: string }[] = [
  { key: 'none', label: '静止基线' },
  { key: 'live', label: '现行 rAF 粒子' },
  { key: 'sprite', label: '预渲染 sprite 循环' },
]
const RUN_ORDER: Strategy[] = ['none', 'live', 'sprite']

const Cell = memo(function Cell({ strategy, fontSize, text }: { strategy: Strategy; fontSize: number; text: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '14px 18px',
        fontSize,
        fontWeight: 700,
        outline: '1px solid color-mix(in oklab, currentColor 12%, transparent)',
      }}
    >
      {strategy === 'none' && <FireTextStatic>{text}</FireTextStatic>}
      {strategy === 'live' && <FireTextLive>{text}</FireTextLive>}
      {strategy === 'sprite' && <FireText>{text}</FireText>}
    </span>
  )
})

export function FireTextBench() {
  const [strategy, setStrategy] = useState<Strategy>('live')
  const [count, setCount] = useState(30)
  const [fontSize, setFontSize] = useState(12)
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  const active = useWindowActive()
  const { rows, running, phase, run } = useBenchRunner<Strategy>()
  const { hasApi, live, selfPid } = useLiveMetrics(running)

  const runBenchmark = useCallback(() => {
    if (!hasApi) return
    void run(RUN_ORDER, setStrategy, (strat) => (strat === 'sprite' ? 3000 : 1500))
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
          数量 <input type="range" min={1} max={100} value={count} onChange={(e) => setCount(+e.target.value)} />
          <b style={{ fontVariantNumeric: 'tabular-nums' }}>{count}</b>
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          字号 <input type="range" min={10} max={48} value={fontSize} onChange={(e) => setFontSize(+e.target.value)} />
          <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fontSize}px</b>
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
        对比 ClaudeModelSelector 里 effort=MAX 常驻的 FireText 火焰徽章两种实现。
        <b>现行 rAF 粒子</b>=每实例 rAF 循环(跟随刷新率,ProMotion=120fps):粒子模拟+canvas 逐帧重绘;亮色模式额外每帧改写 textShadow/backgroundImage(逐帧 style recalc + paint)。
        <b>预渲染 sprite 循环</b>=挂载时用种子 RNG 做 120Hz 周期化粒子模拟(周期性驱动+粒子寿命&lt;周期→稳态严格周期,循环缝闭合),烘焙到横向条带 PNG(帧数按条带宽度上限 16000 设备像素自适应 30-60fps;blob URL,同参数实例共享解码),播放用 CSS steps() 动 transform(合成器);暗色辉光=双层 text-shadow opacity 交叉渐隐,亮色扫光=4 层不同高光位错相位 opacity 三角窗轮换(还原高光游走),全部合成器属性,无 filter/background 动画。
        <b>静止基线</b>=同样的文字样式但零动画、零粒子。真实使用规模是 1 个实例(mosaic 每 pane 一个);数量放大只为让差异超出采样噪声,看 Δvs基线 的相对倍数即可。
        idleWakeups/s 是待机偷烧 CPU 的最灵敏指标。跑批每档 settle 后采 {SAMPLE_COUNT} 次(丢首样)。切换外观会重烘焙条带(明暗配色不同)。
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignContent: 'flex-start', padding: 12 }}>
        {Array.from({ length: count }, (_, i) => (
          <Cell key={`${strategy}-${dark}-${fontSize}-${i}`} strategy={strategy} fontSize={fontSize} text="MAX" />
        ))}
      </div>
    </div>
  )
}
