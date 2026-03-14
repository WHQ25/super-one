import { useRef, useEffect } from 'react'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
}

const COLORS = [
  [255, 255, 200],
  [255, 220, 50],
  [255, 160, 20],
  [255, 80, 0],
  [200, 30, 0],
]

function lerpColor(t: number): [number, number, number] {
  const idx = t * (COLORS.length - 1)
  const i = Math.min(Math.floor(idx), COLORS.length - 2)
  const f = idx - i
  return [
    COLORS[i][0] + (COLORS[i + 1][0] - COLORS[i][0]) * f,
    COLORS[i][1] + (COLORS[i + 1][1] - COLORS[i][1]) * f,
    COLORS[i][2] + (COLORS[i + 1][2] - COLORS[i][2]) * f,
  ]
}

export function FireText({ children }: { children: string }) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const particles: Particle[] = []
    let animId = 0

    function resize() {
      const rect = container!.getBoundingClientRect()
      const pad = 6
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
      const pad = 6
      const textW = w - pad * 2
      const textH = h - pad * 2
      const maxLife = 30 + Math.random() * 30
      particles.push({
        x: pad + Math.random() * textW,
        y: pad + textH * (0.1 + Math.random() * 0.5),
        vx: (Math.random() - 0.5) * 0.15,
        vy: -(0.05 + Math.random() * 0.12),
        life: 0,
        maxLife,
        size: 0.5 + Math.random() * 1.5,
      })
    }

    function frame() {
      const w = parseFloat(canvas!.style.width)
      const h = parseFloat(canvas!.style.height)
      ctx!.clearRect(0, 0, w, h)

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

        const [r, g, b] = lerpColor(t)
        const alpha = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9
        const size = p.size * (1 - t * 0.5)

        ctx!.globalCompositeOperation = 'lighter'
        ctx!.beginPath()
        ctx!.arc(p.x, p.y, size, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(${r|0},${g|0},${b|0},${alpha * 0.8})`
        ctx!.fill()

        ctx!.beginPath()
        ctx!.arc(p.x, p.y, size * 2, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(${r|0},${g|0},${b|0},${alpha * 0.12})`
        ctx!.fill()
      }

      animId = requestAnimationFrame(frame)
    }

    animId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(animId)
  }, [])

  return (
    <span ref={containerRef} className="relative inline-block">
      <canvas ref={canvasRef} className="pointer-events-none absolute" />
      <span className="fire-text-glow relative">{children}</span>
    </span>
  )
}
