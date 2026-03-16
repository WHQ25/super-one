import { useRef, useState, useMemo, useLayoutEffect, useCallback } from 'react'
import morphdom from 'morphdom'
import { SVG_STYLES } from '../../../../shared/generative-ui/svg-styles'
import type { WidgetData } from '../../../../shared/generative-ui/types'
import { Download } from 'lucide-react'

const THROTTLE_MS = 150

function bodyStyle(isSVG: boolean): string {
  return isSVG
    ? 'margin:0;display:flex;align-items:center;justify-content:center;min-height:100%;background:transparent;color:#e0e0e0;'
    : 'margin:0;padding:1rem;font-family:system-ui,-apple-system,sans-serif;background:transparent;color:#e0e0e0;'
}

const SHADOW_STYLES = `*{box-sizing:border-box}
@keyframes _fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes _pulse{0%,100%{opacity:.4}50%{opacity:.7}}
${SVG_STYLES.replace(/:root\s*\{/g, ':host {')}`

const RESIZE_SCRIPT = `<script>new ResizeObserver(()=>{const h=document.body.offsetHeight;if(h>0)parent.postMessage({type:'widget-resize',height:h},'*')}).observe(document.body)</script>`

function buildSrcdoc(code: string, isSVG: boolean): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>*{box-sizing:border-box}body{${bodyStyle(isSVG)}}${SVG_STYLES}</style>
</head><body>${code}${RESIZE_SCRIPT}</body></html>`
}

function canvasToPlaceholder(_match: string, attrs: string): string {
  const wAttr = attrs.match(/width\s*=\s*["']?(\d+)/i)?.[1]
  const hAttr = attrs.match(/height\s*=\s*["']?(\d+)/i)?.[1]
  const styleAttr = attrs.match(/style\s*=\s*["']([^"']*)/i)?.[1] || ''
  const wStyle = styleAttr.match(/width\s*:\s*(\d+(?:px|%))/)?.[1]
  const hStyle = styleAttr.match(/height\s*:\s*(\d+(?:px|%))/)?.[1]
  const w = wAttr ? `${wAttr}px` : wStyle || '100%'
  const h = hAttr ? `${hAttr}px` : hStyle || '200px'
  return `<div style="width:${w};height:${h};background:var(--color-background-secondary);border-radius:var(--border-radius-md,8px);animation:_pulse 2s ease-in-out infinite"></div>`
}

function patchHtmlForShadow(html: string): string {
  html = html.replace(/:root\s*\{/g, ':host {')
  html = html.replace(/<canvas\b([^>]*)>[\s\S]*?<\/canvas>/gi, canvasToPlaceholder)
  html = html.replace(/<canvas\b([^>]*)\/?>/gi, canvasToPlaceholder)
  const tags = ['style', 'script']
  for (const tag of tags) {
    const opens = (html.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length
    const closes = (html.match(new RegExp(`</${tag}>`, 'gi')) || []).length
    for (let i = closes; i < opens; i++) html += `</${tag}>`
  }
  return html
}

function useThrottledValue<T>(value: T, ms: number): T {
  const snapshotRef = useRef(value)
  const lastTimeRef = useRef(0)

  if (ms <= 0) {
    snapshotRef.current = value
    return value
  }

  const now = Date.now()
  if (now - lastTimeRef.current >= ms) {
    lastTimeRef.current = now
    snapshotRef.current = value
  }

  return snapshotRef.current
}

function ShadowWidget({ html, isSVG }: { html: string; isSVG: boolean }) {
  const shadowRef = useRef<ShadowRoot | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const initShadow = useCallback((el: HTMLDivElement | null) => {
    if (!el || shadowRef.current) return
    const shadow = el.attachShadow({ mode: 'open' })
    shadowRef.current = shadow
    const styleEl = document.createElement('style')
    styleEl.textContent = SHADOW_STYLES
    shadow.appendChild(styleEl)
    const root = document.createElement('div')
    root.id = 'root'
    root.style.cssText = bodyStyle(isSVG)
    shadow.appendChild(root)
    rootRef.current = root
  }, [isSVG])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const safeHtml = patchHtmlForShadow(html)

    if (!root.childElementCount) {
      root.innerHTML = safeHtml
      return
    }

    const target = root.cloneNode(false) as HTMLDivElement
    target.innerHTML = safeHtml

    morphdom(root, target, {
      onBeforeElUpdated(from, to) {
        return !from.isEqualNode(to)
      },
      onNodeAdded(node) {
        if (node.nodeType === 1) {
          const el = node as HTMLElement
          if (el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT') {
            el.style.animation = '_fadeIn 0.3s ease both'
          }
        }
        return node
      },
    })
  }, [html, isSVG])

  return (
    <div
      ref={initShadow}
      className="w-full rounded-md"
    />
  )
}

function AutoIframe({ srcdoc, title, fallbackHeight, hidden, onReady }: {
  srcdoc: string; title: string; fallbackHeight: number; hidden?: boolean; onReady?: () => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(fallbackHeight)

  const measure = useCallback(() => {
    try {
      const doc = iframeRef.current?.contentDocument
      if (!doc) return
      const h = doc.body.offsetHeight || doc.documentElement.scrollHeight
      if (h > 0) setHeight(h)
    } catch {}
  }, [])

  useLayoutEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      if (e.data?.type === 'widget-resize' && typeof e.data.height === 'number' && e.data.height > 0) {
        setHeight(e.data.height)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const handleLoad = useCallback(() => {
    measure()
    setTimeout(measure, 300)
    setTimeout(measure, 1000)
    const notify = () => onReady?.()
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(notify, { timeout: 3000 })
    } else {
      setTimeout(notify, 500)
    }
  }, [measure, onReady])

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      onLoad={handleLoad}
      sandbox="allow-scripts allow-same-origin"
      className="w-full border-0 rounded-md"
      style={{ height, display: hidden ? 'none' : undefined }}
      title={title}
    />
  )
}

interface WidgetBlockProps {
  data: WidgetData
  streaming?: boolean
  messageStreaming?: boolean
}

function downloadWidget(srcdoc: string, title: string, e: { stopPropagation(): void }) {
  e.stopPropagation()
  const blob = new Blob([srcdoc], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title}.html`
  a.click()
  URL.revokeObjectURL(url)
}

export function WidgetBlock({ data, streaming, messageStreaming }: WidgetBlockProps) {
  const displayCode = useThrottledValue(data.widget_code, streaming ? THROTTLE_MS : 0)
  const finalSrcdoc = useMemo(() => buildSrcdoc(data.widget_code, data.isSVG), [data.widget_code, data.isSVG])
  const [iframeReady, setIframeReady] = useState(false)
  const messageComplete = !streaming && !messageStreaming
  const showShadow = streaming || !iframeReady

  return (
    <div className="group/widget relative my-0.5 w-full">
      {showShadow && (
        <ShadowWidget html={displayCode} isSVG={data.isSVG} />
      )}
      {messageComplete && (
        <AutoIframe
          srcdoc={finalSrcdoc}
          title={data.title.replace(/_/g, ' ')}
          fallbackHeight={data.height}
          hidden={!iframeReady}
          onReady={() => setIframeReady(true)}
        />
      )}
      {messageComplete && iframeReady && (
        <div className="absolute right-2 top-2 flex items-center gap-2 opacity-0 transition-opacity group-hover/widget:opacity-100">
          <span className="text-xs text-muted-foreground/70">
            {data.title.replace(/_/g, ' ')}
          </span>
          <button
            onClick={(e) => downloadWidget(finalSrcdoc, data.title, e)}
            className="text-muted-foreground/70 transition-colors hover:text-foreground"
            title="Save as HTML"
          >
            <Download className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
