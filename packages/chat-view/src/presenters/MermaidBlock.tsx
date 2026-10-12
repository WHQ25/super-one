import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Code, Copy, Expand, Eye, Image, Loader2 } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import mermaid from 'mermaid'

export const MAX_H = 500
export const OVERFLOW_THRESHOLD = 0.3
export const OVERFLOW_RENDER_RATIO = 0.6

export function parseSize(svg: string): { w: number; h: number } {
  const m = svg.match(/viewBox="([^"]+)"/)
  if (!m) return { w: 0, h: 0 }
  const [, , w, h] = m[1].split(/[\s,]+/).map(Number)
  return { w: Number.isFinite(w) && w > 0 ? w : 0, h: Number.isFinite(h) && h > 0 ? h : 0 }
}

export function computeLayout(
  svgW: number,
  svgH: number,
  containerW: number,
): { overflow: boolean; overflowW: number } {
  if (containerW <= 0 || svgW <= 0 || svgH <= 0) return { overflow: false, overflowW: 0 }
  const widthScale = Math.min(containerW / svgW, 1)
  if (svgH * widthScale <= MAX_H) return { overflow: false, overflowW: 0 }
  const fittedW = svgW * (MAX_H / svgH)
  if (fittedW >= containerW * OVERFLOW_THRESHOLD) return { overflow: false, overflowW: 0 }
  return { overflow: true, overflowW: containerW * OVERFLOW_RENDER_RATIO }
}

export function MermaidPreview({ svg, isThemeSwitching }: {
  svg: string
  isThemeSwitching: boolean
}) {
  const outerRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(0)
  const { w: svgW, h: svgH } = useMemo(() => parseSize(svg), [svg])

  useEffect(() => {
    if (!outerRef.current) return
    const ro = new ResizeObserver(([entry]) => setContainerW(entry.contentRect.width))
    ro.observe(outerRef.current)
    return () => ro.disconnect()
  }, [])

  const { overflow, overflowW } = computeLayout(svgW, svgH, containerW)

  return (
    <div className="relative">
      <div
        ref={outerRef}
        className={overflow
          ? 'overflow-auto p-4'
          : 'p-4 [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:max-h-125'
        }
        style={overflow ? { maxHeight: MAX_H } : undefined}
      >
        {overflow
          ? (
            <div
              className="mx-auto [&_svg]:block [&_svg]:w-full [&_svg]:h-auto [&_svg]:!max-w-full"
              style={{ width: overflowW }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )
          : (
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          )
        }
      </div>
      {isThemeSwitching && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/80 backdrop-blur-sm">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

export interface MermaidBlockPresenterPorts {
  copyText: (text: string) => Promise<boolean>
  copyImage?: (svg: string) => Promise<boolean>
  renderHighlightedCode: (props: { code: string; language: string; isComplete: boolean }) => ReactNode
  renderFullscreen: (props: { svg: string; open: boolean; onOpenChange: (open: boolean) => void }) => ReactNode
}

export interface MermaidBlockPresenterProps {
  code: string
  isComplete: boolean
  scheme: 'light' | 'dark'
  theme: string
  ports: MermaidBlockPresenterPorts
}

export function MermaidBlockPresenter({ code, isComplete, scheme, theme, ports }: MermaidBlockPresenterProps) {
  const { t } = useTranslation()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(false)
  const [copied, setCopied] = useState(false)
  const [imageCopied, setImageCopied] = useState(false)
  const [isThemeSwitching, setIsThemeSwitching] = useState(false)
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const prevThemeKeyRef = useRef(`${scheme}:${theme}`)
  const modeButtonRef = useRef<HTMLButtonElement>(null)
  const restoreModeFocus = useRef(false)
  const reduceMotion = useReducedMotion()
  const previewWidth = useMemo(() => {
    const { w, h } = parseSize(svg ?? '')
    return h > 0 ? w * Math.min(1, MAX_H / h) : w
  }, [svg])

  useEffect(() => {
    if (!isComplete) {
      setSvg(null)
      setError(null)
      return
    }

    const themeKey = `${scheme}:${theme}`
    const isThemeChange = prevThemeKeyRef.current !== themeKey
    if (isThemeChange && svg) {
      setIsThemeSwitching(true)
    } else {
      setSvg(null)
      setError(null)
    }

    let cancelled = false
    mermaid.initialize({
      startOnLoad: false,
      theme: theme as never,
      suppressErrorRendering: true,
    })
    const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    mermaid.render(id, code).then(
      ({ svg: result }) => {
        if (cancelled) return
        setSvg(result)
        setError(null)
        prevThemeKeyRef.current = themeKey
      },
      (err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      },
    ).finally(() => {
      if (!cancelled) setIsThemeSwitching(false)
    })
    return () => { cancelled = true }
  }, [code, isComplete, scheme, theme])

  const handleCopy = useCallback(async () => {
    if (!(await ports.copyText(code))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code, ports])

  const handleCopyImage = useCallback(async () => {
    if (!svg || !(await ports.copyImage?.(svg))) return
    setImageCopied(true)
    setTimeout(() => setImageCopied(false), 2000)
  }, [svg, ports])

  if (!isComplete) {
    return <div data-chat-mermaid="source">{ports.renderHighlightedCode({ code, language: 'mermaid', isComplete: false })}</div>
  }

  const isPreview = !showSource && !error
  const toolbar = (
    <div data-mermaid-toolbar className={cn(
      isPreview
        ? 'absolute right-0 top-0 z-10 flex items-center opacity-0 transition-opacity group-hover/mermaid:opacity-100 group-focus-within/mermaid:opacity-100 [@media(hover:none)]:opacity-100'
        : 'flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground',
    )}>
      {!isPreview && <span className="opacity-50">Mermaid</span>}
      <div className="flex items-center gap-1">
        {svg && (
          <IconButton
            ref={modeButtonRef}
            size="xs"
            variant="ghost"
            onClick={(event) => {
              restoreModeFocus.current = event.currentTarget === event.currentTarget.ownerDocument.activeElement
              setShowSource((v) => !v)
            }}
            className="opacity-50 transition-opacity hover:opacity-100"
            tooltip={showSource ? t('tooltips.mermaidPreview') : t('tooltips.mermaidSource')}
          >
            {showSource ? <Eye className="size-3" /> : <Code className="size-3" />}
          </IconButton>
        )}
        {svg && !showSource && (
          <IconButton
            size="xs"
            variant="ghost"
            onClick={() => setFullscreenOpen(true)}
            className="opacity-50 transition-opacity hover:opacity-100"
            tooltip={t('tooltips.expand')}
          >
            <Expand className="size-3" />
          </IconButton>
        )}
        <IconButton
          size="xs"
          variant="ghost"
          onClick={handleCopy}
          className="opacity-50 transition-opacity hover:opacity-100"
          tooltip={t('tooltips.copyCode')}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </IconButton>
        {svg && ports.copyImage && (
          <IconButton
            size="xs"
            variant="ghost"
            onClick={handleCopyImage}
            className="opacity-50 transition-opacity hover:opacity-100"
            tooltip={t('tooltips.copyImage')}
          >
            {imageCopied ? <Check className="size-3" /> : <Image className="size-3" />}
          </IconButton>
        )}
      </div>
    </div>
  )

  if (error) {
    return (
      <div data-chat-mermaid="error" data-chat-codeblock data-code-source={code} className="my-1.5 overflow-hidden rounded-md border border-destructive/30 bg-destructive/5">
        {toolbar}
        <p className="px-3 pb-3 text-xs text-destructive">Mermaid Error: {error}</p>
      </div>
    )
  }

  if (!svg) {
    return (
      <div data-chat-mermaid="loading" data-chat-codeblock data-code-source={code} className={cn('group/mermaid relative my-1.5 overflow-hidden rounded-md', !isPreview && 'bg-muted/30')}>
        {toolbar}
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="my-1.5 flex justify-center">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={showSource ? 'source' : 'preview'}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.12, ease: 'easeInOut' }}
            onAnimationComplete={(definition) => {
              if (typeof definition === 'object' && 'opacity' in definition && definition.opacity === 1 && restoreModeFocus.current) {
                modeButtonRef.current?.focus({ preventScroll: true })
                restoreModeFocus.current = false
              }
            }}
            data-chat-mermaid={showSource ? 'source' : 'preview'}
            data-chat-codeblock
            data-code-source={code}
            className={cn('group/mermaid relative w-full min-w-0 overflow-hidden rounded-md', showSource && 'bg-muted/30')}
            style={{ '--mermaid-preview-width': `${previewWidth}px` } as CSSProperties}
          >
            {toolbar}
            {showSource
              ? (
                <pre className="overflow-x-auto px-3 pb-3 text-xs leading-relaxed text-muted-foreground">
                  <code>{code}</code>
                </pre>
              )
              : (
                <MermaidPreview
                  svg={svg}
                  isThemeSwitching={isThemeSwitching}
                />
              )
            }
          </motion.div>
        </AnimatePresence>
      </div>
      {ports.renderFullscreen({
        svg,
        open: fullscreenOpen,
        onOpenChange: setFullscreenOpen,
      })}
    </>
  )
}
