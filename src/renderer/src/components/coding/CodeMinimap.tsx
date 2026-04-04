import { useRef, useState, useEffect, useCallback, memo } from 'react'
import type { RefObject } from 'react'
import type { DiffLine, HLToken } from '@/lib/diff-utils'

const CHAR_W = 1.2
const LINE_H = 3
const DEFAULT_MINIMAP_W = 100
const SMALL_MINIMAP_W = 60
const MINIMAP_BREAKPOINT = 400
const GUTTER_W = 3
const MINIMAP_DETAIL_LIMIT = 5000
const MAX_VISIBLE_LINES = 500

export const CodeMinimap = memo(function CodeMinimap({ lines, tokens, scrollRef }: {
  lines: DiffLine[]
  tokens: HLToken[][] | null
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  const [minimapW, setMinimapW] = useState(DEFAULT_MINIMAP_W)
  useEffect(() => {
    const scrollEl = scrollRef.current?.parentElement
    if (!scrollEl) return
    const update = () => {
      const w = scrollEl.clientWidth
      setMinimapW(w < MINIMAP_BREAKPOINT ? SMALL_MINIMAP_W : DEFAULT_MINIMAP_W)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(scrollEl)
    return () => ro.disconnect()
  }, [scrollRef])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const vpRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const canvasH = lines.length * LINE_H
  const maxContainerH = MAX_VISIBLE_LINES * LINE_H

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !canvasH) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = minimapW * dpr
    canvas.height = canvasH * dpr
    canvas.style.width = `${minimapW}px`
    canvas.style.height = `${canvasH}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, minimapW, canvasH)

    const drawDetail = lines.length <= MINIMAP_DETAIL_LIMIT

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const y = i * LINE_H

      if (line.kind === 'added') {
        ctx.fillStyle = 'rgba(34, 197, 94, 0.5)'
        ctx.fillRect(0, y, minimapW, LINE_H)
        ctx.fillStyle = 'rgba(34, 197, 94, 1)'
        ctx.fillRect(0, y, GUTTER_W, LINE_H)
      } else if (line.kind === 'removed') {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.5)'
        ctx.fillRect(0, y, minimapW, LINE_H)
        ctx.fillStyle = 'rgba(239, 68, 68, 1)'
        ctx.fillRect(0, y, GUTTER_W, LINE_H)
      }

      if (!drawDetail) continue

      const lineTokens = line.kind !== 'removed' ? tokens?.[line.sourceIdx] : null
      if (lineTokens) {
        let x = 0
        for (const token of lineTokens) {
          ctx.fillStyle = token.style?.color || 'rgba(150, 150, 150, 0.3)'
          for (const ch of token.content) {
            if (ch === ' ' || ch === '\t') { x += CHAR_W * (ch === '\t' ? 4 : 1); continue }
            if (x >= minimapW) break
            ctx.fillRect(x, y + 0.5, Math.max(CHAR_W * 0.9, 0.8), Math.max(LINE_H - 1, 1))
            x += CHAR_W
          }
          if (x >= minimapW) break
        }
      } else if (line.text) {
        ctx.fillStyle = 'rgba(150, 150, 150, 0.2)'
        let x = 0
        for (const ch of line.text) {
          if (ch === ' ' || ch === '\t') { x += CHAR_W * (ch === '\t' ? 4 : 1); continue }
          if (x >= minimapW) break
          ctx.fillRect(x, y + 0.5, Math.max(CHAR_W * 0.9, 0.8), Math.max(LINE_H - 1, 1))
          x += CHAR_W
        }
      }
    }
  }, [lines, tokens, canvasH, minimapW])

  const syncViewport = useCallback(() => {
    const scrollEl = scrollRef.current
    const container = containerRef.current
    const vp = vpRef.current
    if (!scrollEl || !container || !vp || !scrollEl.scrollHeight || !canvasH) return

    const vpTop = (scrollEl.scrollTop / scrollEl.scrollHeight) * canvasH
    const vpHeight = Math.max((scrollEl.clientHeight / scrollEl.scrollHeight) * canvasH, 10)
    vp.style.top = `${vpTop}px`
    vp.style.height = `${vpHeight}px`

    const visibleH = container.clientHeight
    if (canvasH > visibleH) {
      const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight
      const fileRatio = maxScroll > 0 ? scrollEl.scrollTop / maxScroll : 0
      container.scrollTop = fileRatio * (canvasH - visibleH)
    }
  }, [scrollRef, canvasH])

  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return
    let raf = 0
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(syncViewport) }
    syncViewport()
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    let roRaf = 0
    const ro = new ResizeObserver(() => { cancelAnimationFrame(roRaf); roRaf = requestAnimationFrame(syncViewport) })
    ro.observe(scrollEl)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => { scrollEl.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); cancelAnimationFrame(roRaf); ro.disconnect() }
  }, [scrollRef, syncViewport])

  const scrollToY = useCallback((clientY: number) => {
    const scrollEl = scrollRef.current
    const container = containerRef.current
    if (!scrollEl || !container || !canvasH) return
    const ratio = (clientY - container.getBoundingClientRect().top + container.scrollTop) / canvasH
    scrollEl.scrollTop = ratio * scrollEl.scrollHeight - scrollEl.clientHeight / 2
  }, [scrollRef, canvasH])

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
    if (!scrollEl || !container || !canvasH) return
    const startY = e.clientY
    const startScroll = scrollEl.scrollTop
    const onMove = (ev: MouseEvent) => {
      scrollEl.scrollTop = startScroll + ((ev.clientY - startY) / canvasH) * scrollEl.scrollHeight
    }
    const onUp = () => {
      setTimeout(() => { draggingRef.current = false }, 0)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [scrollRef, canvasH])

  return (
    <div
      ref={containerRef}
      className="relative shrink-0 cursor-pointer overflow-hidden opacity-50 transition-[opacity,width] hover:opacity-70"
      style={{ width: minimapW, maxHeight: maxContainerH, contain: 'strict' }}
      onClick={handleClick}
    >
      <canvas ref={canvasRef} className="block" />
      <div
        ref={vpRef}
        className="absolute left-0 right-0 bg-foreground/30 border border-foreground/50 cursor-grab active:cursor-grabbing"
        onMouseDown={handleDragStart}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
})
