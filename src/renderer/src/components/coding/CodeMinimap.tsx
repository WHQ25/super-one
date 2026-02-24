import { useRef, useEffect, useCallback, useState } from 'react'
import type { RefObject } from 'react'
import type { DiffLine, HLToken } from '@/lib/diff-utils'

const CHAR_W = 1.2
const LINE_H = 3
const MINIMAP_W = 100
const GUTTER_W = 3
const MINIMAP_DETAIL_LIMIT = 5000

export function CodeMinimap({ lines, tokens, scrollRef }: {
  lines: DiffLine[]
  tokens: HLToken[][] | null
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const getMetrics = useCallback(() => {
    const containerH = containerRef.current?.clientHeight ?? 0
    if (!containerH) return { containerH: 0, renderedH: 0, scale: 1 }
    const naturalH = lines.length * LINE_H
    const scale = naturalH > containerH ? containerH / naturalH : 1
    return { containerH, renderedH: Math.min(naturalH, containerH), scale }
  }, [lines.length])

  useEffect(() => {
    const canvas = canvasRef.current
    const { containerH, scale } = getMetrics()
    if (!canvas || !containerH) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = MINIMAP_W * dpr
    canvas.height = containerH * dpr
    canvas.style.width = `${MINIMAP_W}px`
    canvas.style.height = `${containerH}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, MINIMAP_W, containerH)

    const lineH = LINE_H * scale
    const charW = CHAR_W * scale

    const drawDetail = lines.length <= MINIMAP_DETAIL_LIMIT

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const y = i * lineH

      if (line.kind === 'added') {
        ctx.fillStyle = 'rgba(34, 197, 94, 0.15)'
        ctx.fillRect(0, y, MINIMAP_W, lineH)
        ctx.fillStyle = 'rgba(34, 197, 94, 0.7)'
        ctx.fillRect(0, y, GUTTER_W, lineH)
      } else if (line.kind === 'removed') {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.15)'
        ctx.fillRect(0, y, MINIMAP_W, lineH)
        ctx.fillStyle = 'rgba(239, 68, 68, 0.7)'
        ctx.fillRect(0, y, GUTTER_W, lineH)
      }

      if (!drawDetail) continue

      const lineTokens = line.kind !== 'removed' ? tokens?.[line.sourceIdx] : null
      if (lineTokens) {
        let x = 0
        for (const token of lineTokens) {
          ctx.fillStyle = token.style?.color || 'rgba(150, 150, 150, 0.6)'
          for (const ch of token.content) {
            if (ch === ' ' || ch === '\t') { x += charW * (ch === '\t' ? 4 : 1); continue }
            if (x >= MINIMAP_W) break
            ctx.fillRect(x, y + 0.5, Math.max(charW * 0.9, 0.8), Math.max(lineH - 1, 1))
            x += charW
          }
          if (x >= MINIMAP_W) break
        }
      } else if (line.text) {
        ctx.fillStyle = 'rgba(150, 150, 150, 0.4)'
        let x = 0
        for (const ch of line.text) {
          if (ch === ' ' || ch === '\t') { x += charW * (ch === '\t' ? 4 : 1); continue }
          if (x >= MINIMAP_W) break
          ctx.fillRect(x, y + 0.5, Math.max(charW * 0.9, 0.8), Math.max(lineH - 1, 1))
          x += charW
        }
      }
    }
  }, [lines, tokens, getMetrics])

  const [vpTop, setVpTop] = useState(0)
  const [vpHeight, setVpHeight] = useState(0)

  const syncViewport = useCallback(() => {
    const scrollEl = scrollRef.current
    const { renderedH } = getMetrics()
    if (!scrollEl || !renderedH || !scrollEl.scrollHeight) return
    setVpTop((scrollEl.scrollTop / scrollEl.scrollHeight) * renderedH)
    setVpHeight(Math.max((scrollEl.clientHeight / scrollEl.scrollHeight) * renderedH, 10))
  }, [scrollRef, getMetrics])

  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return
    let raf = 0
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(syncViewport) }
    syncViewport()
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(syncViewport)
    ro.observe(scrollEl)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => { scrollEl.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); ro.disconnect() }
  }, [scrollRef, syncViewport])

  const scrollToY = useCallback((clientY: number) => {
    const scrollEl = scrollRef.current
    const container = containerRef.current
    if (!scrollEl || !container) return
    const { renderedH } = getMetrics()
    if (!renderedH) return
    const ratio = (clientY - container.getBoundingClientRect().top) / renderedH
    scrollEl.scrollTop = ratio * scrollEl.scrollHeight - scrollEl.clientHeight / 2
  }, [scrollRef, getMetrics])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (draggingRef.current) return
    scrollToY(e.clientY)
  }, [scrollToY])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    draggingRef.current = true
    const scrollEl = scrollRef.current
    const container = containerRef.current
    if (!scrollEl || !container) return
    const startY = e.clientY
    const startScroll = scrollEl.scrollTop
    const { renderedH } = getMetrics()
    if (!renderedH) return
    const onMove = (ev: MouseEvent) => {
      scrollEl.scrollTop = startScroll + ((ev.clientY - startY) / renderedH) * scrollEl.scrollHeight
    }
    const onUp = () => {
      setTimeout(() => { draggingRef.current = false }, 0)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [scrollRef, getMetrics])

  return (
    <div ref={containerRef} className="relative h-full cursor-pointer opacity-50 transition-opacity hover:opacity-70" style={{ width: MINIMAP_W }} onClick={handleClick}>
      <canvas ref={canvasRef} className="block" />
      <div
        className="absolute left-0 right-0 bg-foreground/30 border border-foreground/50 cursor-grab active:cursor-grabbing"
        style={{ top: vpTop, height: vpHeight }}
        onMouseDown={handleDragStart}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
