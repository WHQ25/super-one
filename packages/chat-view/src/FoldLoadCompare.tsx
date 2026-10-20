import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { initialDocumentScheme } from './document-theme'
import { PortableMessage } from './PortableMessage'
import {
  compareFoldLoad,
  firstScreenMs,
  formatBytes,
  formatDuration,
  formatRate,
  kbpsToSlider,
  NETWORK_PRESETS,
  sliderToKbps,
  type ScreenLoad,
} from './fold-load-compare'

const fieldClass = 'border-border bg-background text-foreground h-8 rounded-md border px-2 text-sm'

/**
 * Two phone transcripts of one cold open. Each stays on the loading cover
 * until its window would have arrived at the chosen downlink, then paints
 * the same rows the phone would.
 */
export function FoldLoadCompare() {
  const comparison = useMemo(() => compareFoldLoad(), [])
  const [kilobitsPerSecond, setKilobitsPerSecond] = useState<number>(NETWORK_PRESETS[0].kilobitsPerSecond)
  const [latencyMs, setLatencyMs] = useState<number>(NETWORK_PRESETS[0].latencyMs)
  const [run, setRun] = useState(1)
  const [progress, setProgress] = useState(0)
  const scheme = initialDocumentScheme(document.documentElement)

  const plainMs = firstScreenMs(comparison.plain.bytes, kilobitsPerSecond, latencyMs)
  const foldedMs = firstScreenMs(comparison.folded.bytes, kilobitsPerSecond, latencyMs)
  const slower = Math.max(plainMs, foldedMs)
  const foldedAdvantage = foldedMs > 0 && Number.isFinite(plainMs) ? plainMs / foldedMs : 1
  const activePreset = NETWORK_PRESETS.find((preset) => preset.kilobitsPerSecond === kilobitsPerSecond && preset.latencyMs === latencyMs)

  useEffect(() => {
    if (run === 0 || !Number.isFinite(slower) || slower <= 0) return
    const visualMs = Math.min(Math.max(slower, 700), 2800)
    const started = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const next = Math.min(1, (now - started) / visualMs)
      setProgress(next)
      if (next < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // Duration is the run that just started. A rate change starts a new run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])

  function replay() {
    setProgress(0)
    setRun((value) => value + 1)
  }

  return (
    <div className="bg-background text-foreground flex w-full flex-col gap-4 p-4">
      <header className="mx-auto flex w-full max-w-3xl flex-col gap-1">
        <h2 className="text-base font-medium">首屏加载</h2>
        <p className="text-muted-foreground text-sm">
          同一段会话的手机冷启动。封面按网速揭开，揭开后是实际会画出来的消息。
          {comparison.turns} 轮，每轮 {comparison.tools} 次工具，每次约 {formatBytes(comparison.outputChars)} 输出。
        </p>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="网速预设">
          {NETWORK_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={activePreset?.id === preset.id}
              className={`h-8 rounded-md border px-3 text-sm ${activePreset?.id === preset.id ? 'border-foreground bg-foreground text-background' : 'border-border bg-background'}`}
              onClick={() => {
                setKilobitsPerSecond(preset.kilobitsPerSecond)
                setLatencyMs(preset.latencyMs)
                replay()
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1 text-sm">
            <span>网速 {formatRate(kilobitsPerSecond)}</span>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={kbpsToSlider(kilobitsPerSecond)}
              aria-label="网速"
              onChange={(event) => setKilobitsPerSecond(sliderToKbps(Number(event.target.value)))}
              onPointerUp={replay}
              onKeyUp={replay}
            />
            <input
              className={fieldClass}
              type="number"
              min={50}
              max={100000}
              step={50}
              value={kilobitsPerSecond}
              aria-label="网速，千比特每秒"
              onChange={(event) => {
                const next = Number(event.target.value)
                if (Number.isFinite(next)) setKilobitsPerSecond(Math.min(100_000, Math.max(50, next)))
              }}
              onBlur={replay}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>往返延迟 {Math.round(latencyMs)} ms</span>
            <input
              className={fieldClass}
              type="number"
              min={0}
              max={2000}
              step={10}
              value={latencyMs}
              aria-label="往返延迟，毫秒"
              onChange={(event) => {
                const next = Number(event.target.value)
                if (Number.isFinite(next)) setLatencyMs(Math.min(2000, Math.max(0, next)))
              }}
              onBlur={replay}
            />
          </label>
          <button type="button" className="border-border h-8 rounded-md border px-3 text-sm" onClick={replay}>
            重放
          </button>
        </div>
        <p className="text-sm">
          {foldedAdvantage > 1.05
            ? `折叠后首屏快 ${foldedAdvantage >= 10 ? Math.round(foldedAdvantage) : foldedAdvantage.toFixed(1)} 倍`
            : '这个网速下两边几乎同时揭开'}
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-4">
        <PhoneFrame
          title="未折叠"
          load={comparison.plain}
          timeMs={plainMs}
          progress={barProgress(progress, plainMs, slower)}
          scheme={scheme}
        />
        <PhoneFrame
          title="已折叠"
          load={comparison.folded}
          timeMs={foldedMs}
          progress={barProgress(progress, foldedMs, slower)}
          scheme={scheme}
        />
      </div>
    </div>
  )
}

function barProgress(progress: number, timeMs: number, slowerMs: number): number {
  if (!Number.isFinite(timeMs) || timeMs <= 0) return 0
  if (!Number.isFinite(slowerMs) || slowerMs <= 0) return 1
  return Math.min(1, (progress * slowerMs) / timeMs)
}

function PhoneFrame({ title, load, timeMs, progress, scheme }: {
  title: string
  load: ScreenLoad
  timeMs: number
  progress: number
  scheme: 'light' | 'dark'
}) {
  const arrived = progress >= 1
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = scroller.current
    if (arrived && node) node.scrollTop = node.scrollHeight
  }, [arrived])

  return (
    <section className="border-border bg-background flex w-full max-w-[390px] flex-col overflow-hidden rounded-2xl border shadow-sm">
      <header className="border-border flex items-baseline justify-between gap-3 border-b px-3 py-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-muted-foreground text-xs tabular-nums">{arrived ? formatDuration(timeMs) : '加载中'} · {formatBytes(load.bytes)}</p>
      </header>
      <div className="bg-muted h-1">
        <div className="bg-foreground h-full" style={{ width: `${progress * 100}%` }} />
      </div>
      <div ref={scroller} className="h-[640px] overflow-y-auto" aria-busy={!arrived}>
        {arrived
          ? load.rows.map((message) => (
            <PortableMessage key={message.id} message={message} scheme={scheme} pendingPermission={null} />
          ))
          : <LoadingCover label={`${title}仍在传输`} />}
      </div>
    </section>
  )
}

function LoadingCover({ label }: { label: string }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  )
}
