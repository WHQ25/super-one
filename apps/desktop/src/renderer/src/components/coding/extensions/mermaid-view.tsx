import { NodeViewWrapper } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NodeViewProps } from '@tiptap/core'
import { Maximize2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@superone/ui/components/ui/dialog'
import { Button } from '@superone/ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { CommandShortcut } from '@superone/ui/components/ui/command'
import { createLowlight } from 'lowlight'
import { mermaidGrammar } from 'lowlight-mermaid'
import { toHtml } from 'hast-util-to-html'
import { useTheme } from '@/hooks/useTheme'
import type { MermaidOptions } from './mermaid-node'

const lowlight = createLowlight()
lowlight.register('mermaid', mermaidGrammar)

function highlightMermaid(code: string): string {
  try {
    const tree = lowlight.highlight('mermaid', code)
    return toHtml(tree)
  } catch {
    return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}

interface MinimapProps {
  svg: string
  svgDimensions: { width: number; height: number }
  svgRenderedDimensions: { width: number; height: number }
  containerDimensions: { width: number; height: number }
  zoom: number
  pan: { x: number; y: number }
  onNavigate: (newPan: { x: number; y: number }) => void
}

const Minimap = ({ svg, svgDimensions, svgRenderedDimensions, containerDimensions, zoom, pan, onNavigate }: MinimapProps) => {
  const minimapSize = { width: 180, height: 135 }
  const minimapRef = useRef<HTMLDivElement>(null)

  const scale = Math.min(
    minimapSize.width / svgDimensions.width,
    minimapSize.height / svgDimensions.height,
  ) * 0.85

  const scaledSvgWidth = Math.min(svgDimensions.width * scale, minimapSize.width)
  const scaledSvgHeight = Math.min(svgDimensions.height * scale, minimapSize.height)

  const processedSvg = useMemo(() => {
    const parser = new DOMParser()
    const doc = parser.parseFromString(svg, 'image/svg+xml')
    const svgEl = doc.querySelector('svg')
    if (svgEl) {
      svgEl.removeAttribute('width')
      svgEl.removeAttribute('height')
      if (!svgEl.getAttribute('viewBox')) {
        svgEl.setAttribute('viewBox', `0 0 ${svgDimensions.width} ${svgDimensions.height}`)
      }
      svgEl.setAttribute('width', scaledSvgWidth.toString())
      svgEl.setAttribute('height', scaledSvgHeight.toString())
      return new XMLSerializer().serializeToString(svgEl)
    }
    return svg
  }, [svg, scaledSvgWidth, scaledSvgHeight, svgDimensions])

  const svgScaleRatio = svgRenderedDimensions.width / svgDimensions.width
  const viewportWidthInSvg = (containerDimensions.width / zoom) / svgScaleRatio
  const viewportHeightInSvg = (containerDimensions.height / zoom) / svgScaleRatio
  const viewportWidth = viewportWidthInSvg * scale
  const viewportHeight = viewportHeightInSvg * scale
  const minimapCenterX = minimapSize.width / 2
  const minimapCenterY = minimapSize.height / 2
  const panOffsetX = -pan.x * scale / zoom / svgScaleRatio
  const panOffsetY = -pan.y * scale / zoom / svgScaleRatio
  const viewportCenterX = minimapCenterX + panOffsetX
  const viewportCenterY = minimapCenterY + panOffsetY
  const viewportX = viewportCenterX - viewportWidth / 2
  const viewportY = viewportCenterY - viewportHeight / 2

  const handleMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!minimapRef.current) return
    const rect = minimapRef.current.getBoundingClientRect()
    const offsetX = e.clientX - rect.left - minimapCenterX
    const offsetY = e.clientY - rect.top - minimapCenterY
    const newPanX = -offsetX * zoom / scale * svgScaleRatio
    const newPanY = -offsetY * zoom / scale * svgScaleRatio
    onNavigate({ x: newPanX, y: newPanY })
  }

  return (
    <div
      ref={minimapRef}
      className="absolute bottom-4 left-4 z-20 cursor-pointer overflow-hidden rounded border border-white/20 bg-black/70 shadow-md backdrop-blur-sm"
      style={{ width: minimapSize.width, height: minimapSize.height }}
      onClick={handleMinimapClick}
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="minimap-svg opacity-50" dangerouslySetInnerHTML={{ __html: processedSvg }} />
      </div>
      <div
        className="pointer-events-none absolute border-2 border-blue-400/60 bg-blue-400/15 transition-all duration-75"
        style={{
          left: Math.max(0, Math.min(minimapSize.width - viewportWidth, viewportX)),
          top: Math.max(0, Math.min(minimapSize.height - viewportHeight, viewportY)),
          width: Math.min(viewportWidth, minimapSize.width),
          height: Math.min(viewportHeight, minimapSize.height),
        }}
      />
    </div>
  )
}

export const MermaidView = ({ node, updateAttributes, selected, deleteNode, extension }: NodeViewProps) => {
  const dictionary = (extension.options as MermaidOptions).dictionary
  const { dark } = useTheme()
  const currentTheme = dark ? 'dark' : 'light'

  const [svg, setSvg] = useState<string>('')
  const [fullscreenSvg, setFullscreenSvg] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [isEditing, setIsEditing] = useState(node.attrs.isEditing as boolean)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingFullscreen, setIsLoadingFullscreen] = useState(false)
  const [isThemeSwitching, setIsThemeSwitching] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isKeyPanning, setIsKeyPanning] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [svgDimensions, setSvgDimensions] = useState({ width: 0, height: 0 })
  const [svgRenderedDimensions, setSvgRenderedDimensions] = useState({ width: 0, height: 0 })
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fullscreenSvgRef = useRef<HTMLDivElement>(null)
  const fullscreenContainerRef = useRef<HTMLDivElement>(null)

  const syntax = node.attrs.syntax as string

  useEffect(() => {
    if (node.attrs.isEditing !== isEditing) {
      setIsEditing(node.attrs.isEditing as boolean)
    }
  }, [node.attrs.isEditing, isEditing])

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.focus()
        adjustTextareaHeight()
      }, 0)
    }
  }, [isEditing])

  useEffect(() => {
    if (isEditing) adjustTextareaHeight()
  }, [syntax, isEditing])

  const prevThemeRef = useRef(currentTheme)

  useEffect(() => {
    if (isEditing || !syntax) return
    const isThemeChange = prevThemeRef.current !== currentTheme
    const hasExistingSvg = !!svg
    if (isThemeChange && hasExistingSvg) {
      setIsThemeSwitching(true)
    } else {
      setIsLoading(true)
      setSvg('')
    }
    setError('')
    let cancelled = false
    const renderDiagram = async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          theme: currentTheme === 'dark' ? 'dark' : 'default',
          securityLevel: 'loose',
          suppressErrorRendering: true,
        })
        const id = `mermaid-${currentTheme}-${Math.random().toString(36).substring(2, 11)}`
        const { svg: renderedSvg } = await mermaid.render(id, syntax)
        if (!cancelled) {
          setSvg(renderedSvg)
          setError('')
          prevThemeRef.current = currentTheme
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to render diagram')
      } finally {
        if (!cancelled) {
          setIsLoading(false)
          setIsThemeSwitching(false)
        }
      }
    }
    renderDiagram()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syntax, isEditing, currentTheme])

  const handleDoubleClick = () => {
    setIsEditing(true)
    updateAttributes({ isEditing: true })
  }

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateAttributes({ syntax: e.target.value })
  }

  const handleTextareaBlur = () => {
    if (!syntax.trim()) {
      deleteNode()
      return
    }
    setIsEditing(false)
    updateAttributes({ isEditing: false })
  }

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (!syntax.trim()) {
        deleteNode()
        return
      }
      setIsEditing(false)
      updateAttributes({ isEditing: false })
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.stopPropagation()
    }
  }

  const scaleSvgForFullscreen = (renderedSvg: string, targetHeight: number): string => {
    const parser = new DOMParser()
    const doc = parser.parseFromString(renderedSvg, 'image/svg+xml')
    const svgEl = doc.querySelector('svg')
    if (svgEl) {
      const viewBox = svgEl.getAttribute('viewBox')
      let originalWidth = 800
      let originalHeight = 600
      if (viewBox) {
        const [, , width, height] = viewBox.split(' ').map(Number)
        originalWidth = width
        originalHeight = height
        svgEl.setAttribute('viewBox', viewBox)
      } else {
        originalWidth = parseFloat(svgEl.getAttribute('width') || '800')
        originalHeight = parseFloat(svgEl.getAttribute('height') || '600')
        svgEl.setAttribute('viewBox', `0 0 ${originalWidth} ${originalHeight}`)
      }
      const aspectRatio = originalWidth / originalHeight
      const targetWidth = targetHeight * aspectRatio
      svgEl.setAttribute('width', targetWidth.toString())
      svgEl.setAttribute('height', targetHeight.toString())
      return new XMLSerializer().serializeToString(svgEl)
    }
    return renderedSvg
  }

  const handleOpenFullscreen = useCallback(async () => {
    setIsFullscreen(true)
    setIsLoadingFullscreen(true)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    try {
      const mermaid = (await import('mermaid')).default
      const screenHeight = window.innerHeight
      const targetHeight = screenHeight * 0.8
      mermaid.initialize({
        startOnLoad: false,
        theme: currentTheme === 'dark' ? 'dark' : 'default',
        securityLevel: 'loose',
      })
      const id = `mermaid-fs-${currentTheme}-${Math.random().toString(36).substring(2, 11)}`
      const { svg: renderedSvg } = await mermaid.render(id, syntax)
      const scaledSvg = scaleSvgForFullscreen(renderedSvg, targetHeight)
      setFullscreenSvg(scaledSvg)
    } catch {
      setFullscreenSvg(svg)
    } finally {
      setIsLoadingFullscreen(false)
    }
  }, [syntax, svg, currentTheme])

  const handleCloseFullscreen = useCallback(() => {
    setIsFullscreen(false)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const handleZoomIn = useCallback(() => setZoom((prev) => Math.min(prev + 0.2, 3)), [])
  const handleZoomOut = useCallback(() => setZoom((prev) => Math.max(prev - 0.2, 0.5)), [])
  const handleResetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])

  const constrainPan = useCallback((newPan: { x: number; y: number }) => {
    if (!svgRenderedDimensions.width || !containerDimensions.width) return newPan
    const scaledSvgWidth = svgRenderedDimensions.width * zoom
    const scaledSvgHeight = svgRenderedDimensions.height * zoom
    const margin = 350
    const maxPanX = Math.max(0, (scaledSvgWidth - containerDimensions.width) / 2 + margin)
    const maxPanY = Math.max(0, (scaledSvgHeight - containerDimensions.height) / 2 + margin)
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, newPan.x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, newPan.y)),
    }
  }, [svgRenderedDimensions.width, svgRenderedDimensions.height, containerDimensions.width, containerDimensions.height, zoom])

  const handlePan = useCallback((deltaX: number, deltaY: number) => {
    setPan((prev) => constrainPan({ x: prev.x + deltaX, y: prev.y + deltaY }))
  }, [constrainPan])

  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setZoom((prev) => Math.max(0.5, Math.min(3, prev + delta)))
    } else {
      setPan((prev) => constrainPan({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }))
    }
  }, [constrainPan])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPan(constrainPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }))
  }

  const handleMouseUp = () => setIsDragging(false)
  const handleMouseLeave = () => setIsDragging(false)

  useEffect(() => {
    if (!isFullscreen || !fullscreenSvg || isLoadingFullscreen) return
    const timer = setTimeout(() => {
      if (!fullscreenSvgRef.current || !fullscreenContainerRef.current) return
      const containerWidth = fullscreenContainerRef.current.clientWidth
      const containerHeight = fullscreenContainerRef.current.clientHeight
      setContainerDimensions({ width: containerWidth, height: containerHeight })
      const svgElement = fullscreenSvgRef.current.querySelector('svg')
      if (svgElement) {
        let svgWidth = 0
        let svgHeight = 0
        const viewBox = svgElement.getAttribute('viewBox')
        if (viewBox) {
          const [, , width, height] = viewBox.split(' ').map(Number)
          svgWidth = width
          svgHeight = height
          setSvgDimensions({ width, height })
        } else {
          try {
            const bbox = svgElement.getBBox()
            svgWidth = bbox.width
            svgHeight = bbox.height
            setSvgDimensions({ width: bbox.width, height: bbox.height })
          } catch {
            svgWidth = svgElement.clientWidth || 800
            svgHeight = svgElement.clientHeight || 600
            setSvgDimensions({ width: svgWidth, height: svgHeight })
          }
        }
        const svgRect = svgElement.getBoundingClientRect()
        setSvgRenderedDimensions({ width: svgRect.width, height: svgRect.height })
      }
      const updateContainerSize = () => {
        if (fullscreenContainerRef.current) {
          setContainerDimensions({
            width: fullscreenContainerRef.current.clientWidth,
            height: fullscreenContainerRef.current.clientHeight,
          })
        }
      }
      window.addEventListener('resize', updateContainerSize)
    }, 100)
    return () => { clearTimeout(timer) }
  }, [isFullscreen, fullscreenSvg, isLoadingFullscreen])

  useEffect(() => {
    if (!isFullscreen) return
    const pressedKeys = new Map<string, number>()
    let animationFrameId: number | null = null
    let holdTimer: ReturnType<typeof setTimeout> | null = null
    let isHolding = false
    const HOLD_THRESHOLD = 200
    const containerWidth = containerDimensions.width || 800
    const containerHeight = containerDimensions.height || 600
    const SPEED_X = containerWidth * 0.012
    const SPEED_Y = containerHeight * 0.012
    const SINGLE_STEP_X = containerWidth * 0.12
    const SINGLE_STEP_Y = containerHeight * 0.12

    const getCombinedDelta = (): [number, number] => {
      let dx = 0, dy = 0
      if (pressedKeys.has('ArrowUp')) dy += SPEED_Y
      if (pressedKeys.has('ArrowDown')) dy -= SPEED_Y
      if (pressedKeys.has('ArrowLeft')) dx += SPEED_X
      if (pressedKeys.has('ArrowRight')) dx -= SPEED_X
      return [dx, dy]
    }

    const animatePan = () => {
      if (pressedKeys.size === 0) { animationFrameId = null; return }
      const [dx, dy] = getCombinedDelta()
      if (dx !== 0 || dy !== 0) handlePan(dx, dy)
      animationFrameId = requestAnimationFrame(animatePan)
    }

    const startHoldMode = () => {
      if (isHolding) return
      isHolding = true
      setIsKeyPanning(true)
      if (animationFrameId === null) {
        animationFrameId = requestAnimationFrame(animatePan)
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '_', '0'].includes(e.key)) {
        e.preventDefault()
        if (e.key === '+' || e.key === '=') handleZoomIn()
        else if (e.key === '-' || e.key === '_') handleZoomOut()
        else if (e.key === '0') handleResetZoom()
        return
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        if (e.repeat) return
        if (pressedKeys.has(e.key)) return
        pressedKeys.set(e.key, Date.now())
        if (isHolding) return
        if (holdTimer === null) {
          holdTimer = setTimeout(() => {
            holdTimer = null
            if (pressedKeys.size > 0) startHoldMode()
          }, HOLD_THRESHOLD)
        }
        return
      }
      switch (e.key) {
        case '+':
        case '=':
          e.preventDefault(); handleZoomIn(); break
        case '-':
        case '_':
          e.preventDefault(); handleZoomOut(); break
        case '0':
          e.preventDefault(); handleResetZoom(); break
        case 'Escape':
          e.preventDefault(); handleCloseFullscreen(); break
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
      const pressTime = pressedKeys.get(e.key)
      if (pressTime === undefined) return
      pressedKeys.delete(e.key)
      if (!isHolding && Date.now() - pressTime < HOLD_THRESHOLD) {
        switch (e.key) {
          case 'ArrowUp': handlePan(0, SINGLE_STEP_Y); break
          case 'ArrowDown': handlePan(0, -SINGLE_STEP_Y); break
          case 'ArrowLeft': handlePan(SINGLE_STEP_X, 0); break
          case 'ArrowRight': handlePan(-SINGLE_STEP_X, 0); break
        }
      }
      if (pressedKeys.size === 0) {
        if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null }
        if (animationFrameId !== null) { cancelAnimationFrame(animationFrameId); animationFrameId = null }
        isHolding = false
        setIsKeyPanning(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      if (holdTimer !== null) clearTimeout(holdTimer)
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullscreen, containerDimensions.width, containerDimensions.height, handlePan, handleZoomIn, handleZoomOut, handleResetZoom, handleCloseFullscreen])

  useEffect(() => {
    if (!isFullscreen || !fullscreenContainerRef.current) return
    const container = fullscreenContainerRef.current
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [isFullscreen, handleWheel])

  useEffect(() => {
    if (!selected || isEditing || !svg || error) return
    const handleSpaceKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        e.stopPropagation()
        handleOpenFullscreen()
      }
    }
    window.addEventListener('keydown', handleSpaceKey)
    return () => window.removeEventListener('keydown', handleSpaceKey)
  }, [selected, isEditing, svg, error, handleOpenFullscreen])

  return (
    <>
      <NodeViewWrapper className={`mermaid-node ${selected ? 'selected' : ''}`}>
        <div ref={containerRef} className="mermaid-container">
          {isEditing ? (
            <div className="mermaid-editor">
              <div className="mermaid-editor-wrapper">
                <pre
                  className="mermaid-highlight"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: highlightMermaid(syntax) + '\n' }}
                />
                <textarea
                  ref={textareaRef}
                  className="mermaid-textarea"
                  value={syntax}
                  onChange={handleTextareaChange}
                  onBlur={handleTextareaBlur}
                  onKeyDown={handleTextareaKeyDown}
                  placeholder={dictionary.placeholder}
                  spellCheck={false}
                />
              </div>
              <div className="mermaid-hint">{dictionary.hint}</div>
            </div>
          ) : (
            <div
              className="mermaid-preview group"
              onDoubleClick={handleDoubleClick}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
            >
              {svg && !error && !isLoading && (
                <div className="absolute left-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleOpenFullscreen}
                            className="h-7 w-7 rounded-r-none border border-r-0 border-white/30 bg-black/70 text-white shadow-md hover:bg-black/80"
                          >
                            <Maximize2 className="h-4 w-4" />
                          </Button>
                          <div className="pointer-events-none flex h-7 items-center rounded-r border border-l-0 border-white/30 bg-black/70 px-2 text-xs text-white shadow-md">
                            Space
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{dictionary.fullscreen}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}
              {isHovered && (
                <div className="mermaid-hover-tooltip">{dictionary.doubleClickToEdit}</div>
              )}
              {isLoading && <div className="mermaid-loading">{dictionary.loading}</div>}
              {error && (
                <div className="mermaid-error">
                  <strong>{dictionary.error}</strong>
                  <pre>{error}</pre>
                </div>
              )}
              {svg && !error && (
                <div className="relative">
                  <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
                  {isThemeSwitching && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/80 backdrop-blur-sm">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>{dictionary.loading}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </NodeViewWrapper>

      <Dialog open={isFullscreen} onOpenChange={handleCloseFullscreen}>
        <DialogContent
          className="!m-0 !h-screen !w-screen !max-h-none !max-w-none gap-0 !rounded-none !border-0 !p-0"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">{dictionary.fullscreen}</DialogTitle>
          <DialogDescription className="sr-only">{dictionary.fullscreenDescription}</DialogDescription>
          <div className="relative h-full w-full bg-muted">
            <div className="absolute right-4 top-4 z-20 flex items-center gap-1.5 text-xs">
              <CommandShortcut className="inline-flex min-w-[2rem] items-center justify-center rounded border border-white/30 bg-black/70 px-2 py-1 text-sm text-white shadow-sm">+</CommandShortcut>
              <CommandShortcut className="inline-flex min-w-[2rem] items-center justify-center rounded border border-white/30 bg-black/70 px-2 py-1 text-sm text-white shadow-sm">-</CommandShortcut>
              <span className="text-muted-foreground">{dictionary.zoom}</span>
              <span className="mx-1 text-muted-foreground/60">·</span>
              <CommandShortcut className="inline-flex items-center justify-center rounded border border-white/30 bg-black/70 px-2 py-1 text-sm text-white shadow-sm">↑↓←→</CommandShortcut>
              <span className="text-muted-foreground">{dictionary.move}</span>
              <span className="mx-1 text-muted-foreground/60">·</span>
              <CommandShortcut className="inline-flex min-w-[2rem] items-center justify-center rounded border border-white/30 bg-black/70 px-2 py-1 text-sm text-white shadow-sm">0</CommandShortcut>
              <span className="text-muted-foreground">{dictionary.reset}</span>
              <span className="mx-1 text-muted-foreground/60">·</span>
              <CommandShortcut className="inline-flex items-center justify-center rounded border border-white/30 bg-black/70 px-2 py-1 text-sm text-white shadow-sm">Esc</CommandShortcut>
              <span className="text-muted-foreground">{dictionary.exit}</span>
            </div>

            <div className="absolute left-4 top-4 z-20 rounded border border-white/30 bg-black/70 px-2.5 py-0.5 shadow-sm backdrop-blur-sm">
              <span className="text-sm font-medium tabular-nums text-white">{Math.round(zoom * 100)}%</span>
            </div>

            {isLoadingFullscreen && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted">
                <div className="text-muted-foreground">{dictionary.loading}</div>
              </div>
            )}

            {!isLoadingFullscreen && fullscreenSvg && (
              <>
                <div
                  ref={fullscreenContainerRef}
                  className="flex h-full w-full select-none items-center justify-center overflow-hidden"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseLeave}
                  style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                >
                  <div
                    ref={fullscreenSvgRef}
                    className={`mermaid-svg-fullscreen ${isDragging || isKeyPanning ? '' : 'transition-transform duration-150 ease-out'}`}
                    style={{
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                      transformOrigin: 'center',
                    }}
                    dangerouslySetInnerHTML={{ __html: fullscreenSvg }}
                  />
                </div>

                {svgDimensions.width > 0 && svgDimensions.height > 0 && svgRenderedDimensions.width > 0 && (
                  <Minimap
                    svg={fullscreenSvg}
                    svgDimensions={svgDimensions}
                    svgRenderedDimensions={svgRenderedDimensions}
                    containerDimensions={containerDimensions}
                    zoom={zoom}
                    pan={pan}
                    onNavigate={(newPan) => setPan(constrainPan(newPan))}
                  />
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
