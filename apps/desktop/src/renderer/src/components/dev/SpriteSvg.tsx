import React, { useEffect, useRef, useState } from 'react'

interface BakeResult {
  url: string
  frames: number
  loopMs: number
  bytes: number
  ms: number
  animName: string
}

const MAX_SHEET_PX = 16384

const cache = new Map<string, BakeResult>()
const inflight = new Map<string, Promise<BakeResult>>()

const SNAP = [
  'transform',
  'transform-origin',
  'transform-box',
  'opacity',
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
]

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a
}

function detectLoopMs(svg: SVGSVGElement): number {
  let loop = 0
  for (const anim of svg.getAnimations({ subtree: true })) {
    const timing = (anim.effect as KeyframeEffect | null)?.getTiming()
    const dur = Math.round(typeof timing?.duration === 'number' ? timing.duration : 0)
    if (dur > 0) loop = loop ? (loop * dur) / gcd(loop, dur) : dur
  }
  return loop || 1000
}

function snapshotMarkup(svg: SVGSVGElement, w: number, h: number): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const src = svg.querySelectorAll('*')
  const dst = clone.querySelectorAll('*')
  for (let i = 0; i < src.length && i < dst.length; i++) {
    const cs = getComputedStyle(src[i])
    let inline = 'animation:none;'
    for (const prop of SNAP) {
      const value = cs.getPropertyValue(prop)
      if (value && value !== 'none') inline += `${prop}:${value};`
    }
    dst[i].setAttribute('style', inline)
  }
  clone.querySelectorAll('style').forEach((s) => s.remove())
  return new XMLSerializer().serializeToString(clone)
}

function loadImage(url: string, w: number, h: number): Promise<HTMLImageElement> {
  const img = new Image(w, h)
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('svg raster failed'))
    img.src = url
  })
}

async function bake(
  svg: SVGSVGElement,
  w: number,
  h: number,
  dpr: number,
  fps: number,
  maxFrames: number,
  fit: 'center' | 'fill',
  childW: number,
  childH: number,
  animName: string,
): Promise<BakeResult> {
  const t0 = performance.now()
  const loopMs = detectLoopMs(svg)
  const anims = svg.getAnimations({ subtree: true })
  anims.forEach((a) => a.pause())
  const fw = Math.round(w * dpr)
  const fh = Math.round(h * dpr)
  const aw = fit === 'center' ? Math.round(childW * dpr) : fw
  const ah = fit === 'center' ? Math.round(childH * dpr) : fh
  const ox = Math.round((fw - aw) / 2)
  const oy = Math.round((fh - ah) / 2)
  const want = Math.max(2, Math.min(maxFrames, Math.round((loopMs / 1000) * fps)))
  const frames = Math.max(2, Math.min(want, Math.floor(MAX_SHEET_PX / fw)))
  const urls: string[] = []
  for (let j = 0; j < frames; j++) {
    anims.forEach((a) => {
      a.currentTime = (j / frames) * loopMs
    })
    urls.push(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(snapshotMarkup(svg, aw, ah))}`)
  }
  const imgs = await Promise.all(urls.map((u) => loadImage(u, aw, ah)))
  const sheet = document.createElement('canvas')
  sheet.width = fw * frames
  sheet.height = fh
  const sc = sheet.getContext('2d')!
  imgs.forEach((img, j) => sc.drawImage(img, j * fw + ox, oy, aw, ah))
  const style = document.createElement('style')
  style.textContent = `@keyframes ${animName}{from{background-position-x:0}to{background-position-x:-${frames * w}px}}`
  document.head.appendChild(style)
  const bytes = sheet.width * sheet.height * 4
  const url = await new Promise<string>((resolve) =>
    sheet.toBlob((b) => resolve(URL.createObjectURL(b!)), 'image/png'),
  )
  sheet.width = 0
  sheet.height = 0
  return { url, frames, loopMs, bytes, ms: Math.round(performance.now() - t0), animName }
}

export interface SpriteSvgProps {
  cacheKey: string
  width: number
  height: number
  fps?: number
  maxFrames?: number
  objectFit?: 'center' | 'fill'
  debug?: boolean
  onBake?: (info: { frames: number; loopMs: number; bytes: number; ms: number }) => void
  children: React.ReactNode
}

export function SpriteSvg({
  cacheKey,
  width,
  height,
  fps = 30,
  maxFrames = 150,
  objectFit = 'center',
  debug = false,
  onBake,
  children,
}: SpriteSvgProps) {
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1
  const key = `${cacheKey}@${width}x${height}@${dpr}@${fps}@${maxFrames}@${objectFit}`
  const [result, setResult] = useState<BakeResult | null>(() => cache.get(key) ?? null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const onBakeRef = useRef(onBake)
  onBakeRef.current = onBake

  useEffect(() => {
    if (result) onBakeRef.current?.({ frames: result.frames, loopMs: result.loopMs, bytes: result.bytes, ms: result.ms })
  }, [result])

  useEffect(() => {
    if (result) return
    if (typeof window === 'undefined') return
    const cached = cache.get(key)
    if (cached) {
      setResult(cached)
      return
    }
    const svg = ref.current?.querySelector('svg') as SVGSVGElement | null
    if (!svg) return
    const childW = svg.clientWidth || width
    const childH = svg.clientHeight || height
    let cancelled = false
    let task = inflight.get(key)
    if (!task) {
      const animName = `sprite_${key.replace(/[^a-zA-Z0-9]/g, '_')}`
      task = bake(svg, width, height, dpr, fps, maxFrames, objectFit, childW, childH, animName)
        .then((res) => {
          cache.set(key, res)
          return res
        })
        .finally(() => {
          inflight.delete(key)
        })
      inflight.set(key, task)
    }
    task
      .then((res) => {
        if (!cancelled) setResult(res)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String((e as Error)?.message ?? e))
      })
    return () => {
      cancelled = true
    }
  }, [key, result, width, height, dpr, fps, maxFrames, objectFit])

  if (error && debug) {
    return (
      <span
        style={{
          display: 'inline-block',
          width,
          height,
          fontSize: 7,
          lineHeight: '8px',
          color: '#ef4444',
          overflow: 'hidden',
          wordBreak: 'break-all',
        }}
      >
        {error}
      </span>
    )
  }

  if (result) {
    return (
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width,
          height,
          backgroundImage: `url(${result.url})`,
          backgroundSize: `${width * result.frames}px ${height}px`,
          backgroundRepeat: 'no-repeat',
          animation: `${result.animName} ${result.loopMs}ms steps(${result.frames}) infinite`,
        }}
      />
    )
  }

  return (
    <span ref={ref} style={{ display: 'inline-block', width, height, lineHeight: 0 }}>
      {children}
    </span>
  )
}
