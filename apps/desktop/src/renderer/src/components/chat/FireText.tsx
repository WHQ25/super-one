import { useEffect, useRef, useState } from 'react'

export const DARK_COLORS = [
  [255, 255, 200],
  [255, 220, 50],
  [255, 160, 20],
  [255, 80, 0],
  [200, 30, 0],
]

export const LIGHT_COLORS = [
  [255, 220, 50],
  [255, 160, 20],
  [255, 80, 0],
  [200, 30, 0],
  [140, 20, 8],
]

export function lerpColor(colors: number[][], t: number): [number, number, number] {
  const idx = t * (colors.length - 1)
  const i = Math.min(Math.floor(idx), colors.length - 2)
  const f = idx - i
  return [
    colors[i][0] + (colors[i + 1][0] - colors[i][0]) * f,
    colors[i][1] + (colors[i + 1][1] - colors[i][1]) * f,
    colors[i][2] + (colors[i + 1][2] - colors[i][2]) * f,
  ]
}

const PHYS_HZ = 120
const PERIOD_S = 2
const PERIOD_STEPS = PHYS_HZ * PERIOD_S
const MAX_STRIP_DEVICE_PX = 16000
const PAD = 12

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface SpawnEvent {
  x: number
  y: number
  vx: number
  vy: number
  maxLife: number
  size: number
  seed: number
}

interface SimParticle extends SpawnEvent {
  life: number
  jitter: () => number
}

function buildStripCanvas(textW: number, textH: number, isDark: boolean, dpr: number): {
  canvas: HTMLCanvasElement
  frameW: number
  frameH: number
  frameCount: number
} {
  const frameW = textW + PAD * 2
  const frameH = textH + PAD * 2
  let captureEvery = 2
  while (frameW * (PERIOD_STEPS / captureEvery) * dpr > MAX_STRIP_DEVICE_PX && captureEvery < 8) {
    captureEvery *= 2
  }
  const frameCount = PERIOD_STEPS / captureEvery
  const rng = mulberry32(isDark ? 0x9e3779b9 : 0x85ebca6b)
  const colors = isDark ? DARK_COLORS : LIGHT_COLORS

  const spawns: (SpawnEvent | null)[] = []
  for (let s = 0; s < PERIOD_STEPS; s++) {
    spawns.push(
      rng() < 0.6
        ? {
            x: PAD + rng() * textW,
            y: PAD + textH * (0.1 + rng() * 0.5),
            vx: (rng() - 0.5) * 0.15,
            vy: -(0.05 + rng() * 0.12),
            maxLife: 30 + rng() * 30,
            size: 0.5 + rng() * 1.5,
            seed: Math.imul(s + 1, 2654435761),
          }
        : null,
    )
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(frameW * frameCount * dpr)
  canvas.height = Math.ceil(frameH * dpr)
  const ctx = canvas.getContext('2d')!

  let particles: SimParticle[] = []
  for (let g = 0; g < PERIOD_STEPS * 2; g++) {
    const ev = spawns[g % PERIOD_STEPS]
    if (ev) particles.push({ ...ev, life: 0, jitter: mulberry32(ev.seed) })
    for (const p of particles) {
      p.life++
      p.x += p.vx
      p.vy -= 0.005
      p.y += p.vy
      p.vx += (p.jitter() - 0.5) * 0.08
    }
    particles = particles.filter((p) => p.life / p.maxLife < 1)

    if (g < PERIOD_STEPS || (g - PERIOD_STEPS) % captureEvery !== 0) continue
    const f = (g - PERIOD_STEPS) / captureEvery
    ctx.save()
    ctx.translate(f * frameW * dpr, 0)
    ctx.scale(dpr, dpr)
    ctx.beginPath()
    ctx.rect(0, 0, frameW, frameH)
    ctx.clip()
    ctx.globalCompositeOperation = isDark ? 'lighter' : 'source-over'
    for (const p of particles) {
      const t = p.life / p.maxLife
      const [r, gr, b] = lerpColor(colors, t)
      const alpha = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9
      const size = p.size * (1 - t * 0.5)
      const rgb = `${r | 0},${gr | 0},${b | 0}`
      ctx.beginPath()
      ctx.arc(p.x, p.y, size * 2, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${rgb},${alpha * 0.12})`
      ctx.fill()
      ctx.beginPath()
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${rgb},${alpha * 0.8})`
      ctx.fill()
    }
    ctx.restore()
  }

  return { canvas, frameW, frameH, frameCount }
}

interface Strip {
  url: string
  frameW: number
  frameH: number
  frameCount: number
}

const stripCache = new Map<string, Promise<Strip>>()

function getStrip(textW: number, textH: number, isDark: boolean, dpr: number): Promise<Strip> {
  const key = `${textW}x${textH}|${isDark ? 'd' : 'l'}|${dpr}`
  let p = stripCache.get(key)
  if (!p) {
    p = new Promise<Strip>((resolve, reject) => {
      const { canvas, frameW, frameH, frameCount } = buildStripCanvas(textW, textH, isDark, dpr)
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('toBlob failed')); return }
        resolve({ url: URL.createObjectURL(blob), frameW, frameH, frameCount })
      })
    })
    stripCache.set(key, p)
  }
  return p
}

function useIsDarkClass(): boolean {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => setIsDark(el.classList.contains('dark')))
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return isDark
}

const SWEEP_S = 2.8
const SWEEP_STOPS: [number, number][] = [
  [50, 58],
  [96, 40],
  [58, 22],
  [8, 48],
]

function sweepGradient(cx: number, cy: number): string {
  return `radial-gradient(circle at ${cx}% ${cy}%, #ffc24d, #f08c00 32%, #e8590c 58%, #b23c0a)`
}

function TextLayers({ children, isDark, animate }: { children: string; isDark: boolean; animate: boolean }) {
  const anim = animate ? undefined : ({ animation: 'none' } as const)
  if (isDark) {
    return (
      <span className="relative inline-block" style={{ color: '#ffd700' }}>
        <span aria-hidden className="fire-sprite-glow-a absolute left-0 top-0" style={anim}>{children}</span>
        {animate && <span aria-hidden className="fire-sprite-glow-b absolute left-0 top-0">{children}</span>}
        <span className="relative">{children}</span>
      </span>
    )
  }
  return (
    <span className="relative inline-block">
      <span aria-hidden className="fire-sprite-ember absolute left-0 top-0">{children}</span>
      <span className="fire-sprite-fill relative">{children}</span>
      {animate && SWEEP_STOPS.map(([cx, cy], i) => (
        <span
          key={i}
          aria-hidden
          className="fire-sprite-fill fire-sprite-sweep absolute left-0 top-0"
          style={{
            backgroundImage: sweepGradient(cx, cy),
            animationDelay: `${(-i * SWEEP_S / SWEEP_STOPS.length).toFixed(2)}s`,
          }}
        >
          {children}
        </span>
      ))}
    </span>
  )
}

export function FireText({ children }: { children: string }) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const isDark = useIsDarkClass()
  const [strip, setStrip] = useState<Strip | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let cancelled = false
    document.fonts.ready.then(() => {
      if (cancelled) return
      const rect = el.getBoundingClientRect()
      const textW = Math.max(1, Math.round(rect.width))
      const textH = Math.max(1, Math.round(rect.height))
      const dpr = window.devicePixelRatio || 1
      getStrip(textW, textH, isDark, dpr).then((s) => {
        if (!cancelled) setStrip(s)
      }).catch(() => {})
    })
    return () => { cancelled = true }
  }, [isDark, children])

  return (
    <span ref={containerRef} className="relative inline-block">
      {strip && (
        <span
          className="pointer-events-none absolute overflow-hidden"
          style={{ left: -PAD, top: -PAD, width: strip.frameW, height: strip.frameH }}
        >
          <img
            src={strip.url}
            alt=""
            draggable={false}
            style={{
              display: 'block',
              width: strip.frameW * strip.frameCount,
              height: strip.frameH,
              maxWidth: 'none',
              animation: `fire-strip ${PERIOD_S}s steps(${strip.frameCount}) infinite`,
              willChange: 'transform',
            }}
          />
        </span>
      )}
      <TextLayers isDark={isDark} animate>{children}</TextLayers>
    </span>
  )
}

export function FireTextStatic({ children }: { children: string }) {
  const isDark = useIsDarkClass()
  return (
    <span className="relative inline-block">
      <TextLayers isDark={isDark} animate={false}>{children}</TextLayers>
    </span>
  )
}
