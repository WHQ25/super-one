import { useEffect, useRef, useState } from 'react'
import { DARK_COLORS, FIRE_SWEEP_CENTERS, FIRE_SWEEP_S, LIGHT_COLORS, lerpColor } from '@superone/shared/effort-easter-egg-palette'
import {
  buildSpawnSchedule,
  CORE_ALPHA,
  DARK_SEED,
  HALO_ALPHA,
  HALO_RADIUS,
  LIGHT_SEED,
  particleAge,
  particleAlpha,
  particleRadius,
  PERIOD_S,
  PERIOD_STEPS,
  spawnParticle,
  stepParticle,
  type FireParticle,
} from '@superone/shared/fire-particles'

export { DARK_COLORS, LIGHT_COLORS, lerpColor }


const MAX_STRIP_DEVICE_PX = 16000
const PAD = 12

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
  const colors = isDark ? DARK_COLORS : LIGHT_COLORS
  const spawns = buildSpawnSchedule(textW, textH, isDark ? DARK_SEED : LIGHT_SEED)

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(frameW * frameCount * dpr)
  canvas.height = Math.ceil(frameH * dpr)
  const ctx = canvas.getContext('2d')!

  let particles: FireParticle[] = []
  // The first period is warm-up: by the time frames are captured the fire is
  // already fully populated, so frame 0 loops seamlessly onto the last frame.
  for (let g = 0; g < PERIOD_STEPS * 2; g++) {
    const ev = spawns[g % PERIOD_STEPS]
    if (ev) particles.push(spawnParticle(ev))
    for (const p of particles) stepParticle(p)
    particles = particles.filter((p) => particleAge(p) < 1)

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
      const t = particleAge(p)
      const [r, gr, b] = lerpColor(colors, t)
      const alpha = particleAlpha(t)
      const size = particleRadius(p.size, t)
      const rgb = `${r | 0},${gr | 0},${b | 0}`
      ctx.beginPath()
      ctx.arc(PAD + p.x, PAD + p.y, size * HALO_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${rgb},${alpha * HALO_ALPHA})`
      ctx.fill()
      ctx.beginPath()
      ctx.arc(PAD + p.x, PAD + p.y, size, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${rgb},${alpha * CORE_ALPHA})`
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
      {animate && FIRE_SWEEP_CENTERS.map(([cx, cy], i) => (
        <span
          key={i}
          aria-hidden
          className="fire-sprite-fill fire-sprite-sweep absolute left-0 top-0"
          style={{
            backgroundImage: sweepGradient(cx, cy),
            animationDelay: `${(-i * FIRE_SWEEP_S / FIRE_SWEEP_CENTERS.length).toFixed(2)}s`,
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
