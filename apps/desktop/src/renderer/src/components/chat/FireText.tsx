import { useRef, useEffect, useState } from 'react'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
}

const DARK_COLORS = [
  [255, 255, 200],
  [255, 220, 50],
  [255, 160, 20],
  [255, 80, 0],
  [200, 30, 0],
]

const LIGHT_COLORS = [
  [255, 220, 50],
  [255, 160, 20],
  [255, 80, 0],
  [200, 30, 0],
  [140, 20, 8],
]

function lerpColor(colors: number[][], t: number): [number, number, number] {
  const idx = t * (colors.length - 1)
  const i = Math.min(Math.floor(idx), colors.length - 2)
  const f = idx - i
  return [
    colors[i][0] + (colors[i + 1][0] - colors[i][0]) * f,
    colors[i][1] + (colors[i + 1][1] - colors[i][1]) * f,
    colors[i][2] + (colors[i + 1][2] - colors[i][2]) * f,
  ]
}

function noise(t: number, freq: number, phase: number): number {
  return Math.sin(t * freq + phase) + Math.sin(t * freq * 1.618 + phase * 2.13) * 0.5
}

export function FireText({ children }: { children: string }) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glowRef = useRef<HTMLSpanElement>(null)
  const fillRef = useRef<HTMLSpanElement>(null)
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => setIsDark(el.classList.contains('dark')))
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const colors = isDark ? DARK_COLORS : LIGHT_COLORS

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const particles: Particle[] = []
    let animId = 0

    function resize() {
      const rect = container!.getBoundingClientRect()
      const pad = 12
      canvas!.style.width = `${rect.width + pad * 2}px`
      canvas!.style.height = `${rect.height + pad * 2}px`
      canvas!.style.left = `${-pad}px`
      canvas!.style.top = `${-pad}px`
      canvas!.width = (rect.width + pad * 2) * dpr
      canvas!.height = (rect.height + pad * 2) * dpr
      ctx!.scale(dpr, dpr)
    }

    resize()

    function spawn() {
      const w = parseFloat(canvas!.style.width)
      const h = parseFloat(canvas!.style.height)
      const pad = 12
      const textW = w - pad * 2
      const textH = h - pad * 2
      particles.push({
        x: pad + Math.random() * textW,
        y: pad + textH * (0.1 + Math.random() * 0.5),
        vx: (Math.random() - 0.5) * 0.15,
        vy: -(0.05 + Math.random() * 0.12),
        life: 0,
        maxLife: 30 + Math.random() * 30,
        size: 0.5 + Math.random() * 1.5,
      })
    }

    function flicker(time: number) {
      const glow = glowRef.current
      const fill = fillRef.current
      if (!glow || !fill) return
      const cx = (50 + noise(time, 1.4, 0) * 36).toFixed(1)
      const cy = (45 + noise(time, 2.1, 2) * 28).toFixed(1)
      fill.style.backgroundImage = `radial-gradient(circle at ${cx}% ${cy}%, #ffc24d, #f08c00 32%, #e8590c 58%, #b23c0a)`
      fill.style.filter = `brightness(${(1 + noise(time, 7.9, 1) * 0.04).toFixed(3)})`
      const a = 0.34 + noise(time, 6.5, 0) * 0.08
      const bl = 1.9 + noise(time, 4.4, 1) * 0.6
      const up = (0.9 + noise(time, 5.2, 2) * 0.4).toFixed(1)
      glow.style.textShadow = `0 0 ${(bl * 0.8).toFixed(1)}px rgba(235,95,15,${a.toFixed(3)}), 0 0 ${(bl * 1.7).toFixed(1)}px rgba(200,50,5,${(a * 0.55).toFixed(3)}), 0 -${up}px ${(bl * 2.6).toFixed(1)}px rgba(225,80,0,${(a * 0.5).toFixed(3)})`
    }

    function frame(now: number) {
      const w = parseFloat(canvas!.style.width)
      const h = parseFloat(canvas!.style.height)
      ctx!.clearRect(0, 0, w, h)

      if (!isDark) flicker(now / 1000)
      if (Math.random() < 0.6) spawn()

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life++
        p.x += p.vx
        p.vy -= 0.005
        p.y += p.vy
        p.vx += (Math.random() - 0.5) * 0.08

        const t = p.life / p.maxLife
        if (t >= 1) { particles.splice(i, 1); continue }

        const [r, g, b] = lerpColor(colors, t)
        const alpha = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9
        const size = p.size * (1 - t * 0.5)
        const rgb = `${r | 0},${g | 0},${b | 0}`

        ctx!.globalCompositeOperation = isDark ? 'lighter' : 'source-over'
        ctx!.beginPath()
        ctx!.arc(p.x, p.y, size * 2, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(${rgb},${alpha * 0.12})`
        ctx!.fill()

        ctx!.beginPath()
        ctx!.arc(p.x, p.y, size, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(${rgb},${alpha * 0.8})`
        ctx!.fill()
      }

      animId = requestAnimationFrame(frame)
    }

    animId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(animId)
  }, [isDark])

  return (
    <span ref={containerRef} className="relative inline-block">
      <canvas ref={canvasRef} className="pointer-events-none absolute" />
      {isDark ? (
        <span className="fire-text-glow relative">{children}</span>
      ) : (
        <>
          <span ref={glowRef} aria-hidden="true" className="fire-text-ember absolute left-0 top-0">
            {children}
          </span>
          <span ref={fillRef} className="fire-text-fill relative">
            {children}
          </span>
        </>
      )}
    </span>
  )
}
