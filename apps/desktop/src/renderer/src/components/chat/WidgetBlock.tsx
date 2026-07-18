import { useRef, useState, useMemo, useLayoutEffect, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import morphdom from 'morphdom'
import { SVG_STYLES } from '@superone/shared/generative-ui/svg-styles'
import { rewriteCdnUrls } from '@superone/shared/generative-ui/cdn-allowlist'
import type { WidgetData } from '@superone/shared/generative-ui/types'
import { Download } from 'lucide-react'
import { useChatStore } from '@/stores/chat'

const THROTTLE_MS = 150

function bodyStyle(isSVG: boolean): string {
  return isSVG
    ? 'margin:0;display:flex;align-items:center;justify-content:center;min-height:100%;background:transparent;color:var(--color-text-primary);'
    : 'margin:0;font-family:system-ui,-apple-system,sans-serif;background:transparent;color:var(--color-text-primary);'
}

const SHADOW_STYLES = `*{box-sizing:border-box}
@keyframes _fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes _pulse{0%,100%{opacity:.4}50%{opacity:.7}}
${SVG_STYLES
  .replace(/:root\s*\{/g, ':host {')
  .replace(/\.dark\s*\{/g, ':host-context(.dark) {')
  .replace(/\.dark\s+svg/g, ':host-context(.dark) svg')
  .replace(/\.dark\s+input/g, ':host-context(.dark) input')}`

const BRIDGE_SCRIPT = `<script>
(function(){
  window.addEventListener('message',function(e){
    var d=e.data;
    if(d&&d.type==='widget-theme')document.documentElement.classList.toggle('dark',!!d.dark)
  });
  window.sendPrompt=function(t){parent.postMessage({type:'widget-sendPrompt',text:String(t)},'*')};
  window.openLink=function(u){parent.postMessage({type:'widget-openLink',url:String(u)},'*')};
  document.addEventListener('click',function(e){
    var a=e.target.closest('a[href]');
    if(a&&/^https?:/.test(a.href)){e.preventDefault();openLink(a.href)}
  });
  new ResizeObserver(function(){var h=document.body.offsetHeight;if(h>0)parent.postMessage({type:'widget-resize',height:h},'*')}).observe(document.body);
  document.documentElement.style.overflow='hidden';
  document.body.style.overflow='hidden';
  window.addEventListener('wheel',function(e){parent.postMessage({type:'widget-wheel',deltaX:e.deltaX,deltaY:e.deltaY,deltaMode:e.deltaMode},'*')},{passive:true});
  parent.postMessage({type:'widget-ready'},'*');
})();
</script>`

function buildSrcdoc(code: string, isSVG: boolean): string {
  const safeCode = rewriteCdnUrls(code)
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>*{box-sizing:border-box}body{${bodyStyle(isSVG)}}${SVG_STYLES}</style>
</head><body>${safeCode}${BRIDGE_SCRIPT}</body></html>`
}

function canvasToPlaceholder(_match: string, attrs: string): string {
  const id = attrs.match(/id\s*=\s*["']([^"']+)/i)?.[1]
  const cls = attrs.match(/class\s*=\s*["']([^"']+)/i)?.[1]
  const existingStyle = attrs.match(/style\s*=\s*["']([^"']*)/i)?.[1] || ''
  const wAttr = attrs.match(/width\s*=\s*["']?(\d+)/i)?.[1]
  const hAttr = attrs.match(/height\s*=\s*["']?(\d+)/i)?.[1]
  let sizeStyle = ''
  if (!existingStyle.includes('width')) sizeStyle += wAttr ? `width:${wAttr}px;` : 'width:100%;'
  if (!existingStyle.includes('height')) sizeStyle += hAttr ? `height:${hAttr}px;` : 'height:100%;'
  const placeholderStyle = 'background:var(--color-background-secondary);border-radius:var(--border-radius-md,8px);animation:_pulse 2s ease-in-out infinite;'
  const finalStyle = `${existingStyle};${sizeStyle}${placeholderStyle}`
  const idAttr = id ? ` id="${id}"` : ''
  const clsAttr = cls ? ` class="${cls}"` : ''
  return `<div${idAttr}${clsAttr} style="${finalStyle}"></div>`
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

  useEffect(() => {
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

  const postTheme = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'widget-theme', dark: document.documentElement.classList.contains('dark') },
      '*',
    )
  }, [])

  useEffect(() => {
    const observer = new MutationObserver(postTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [postTheme])

  useLayoutEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      const { data } = e
      if (!data?.type) return
      switch (data.type) {
        case 'widget-ready':
          postTheme()
          break
        case 'widget-resize':
          if (typeof data.height === 'number' && data.height > 0) setHeight(data.height)
          break
        case 'widget-sendPrompt':
          if (typeof data.text === 'string') useChatStore.getState().setDraftText(data.text)
          break
        case 'widget-openLink':
          if (typeof data.url === 'string') window.open(data.url, '_blank')
          break
        case 'widget-wheel':
          iframeRef.current?.dispatchEvent(new WheelEvent('wheel', { deltaX: data.deltaX, deltaY: data.deltaY, deltaMode: data.deltaMode, bubbles: true }))
          break
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [postTheme])

  const handleLoad = useCallback(() => {
    onReady?.()
  }, [onReady])

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      onLoad={handleLoad}
      sandbox="allow-scripts"
      className="w-full border-0 rounded-md"
      style={hidden
        ? { height, visibility: 'hidden' as const, position: 'absolute' as const, inset: 0 }
        : { height }}
      title={title}
    />
  )
}

interface WidgetBlockProps {
  data: WidgetData
  streaming?: boolean
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

export function WidgetBlock({ data, streaming }: WidgetBlockProps) {
  const { t } = useTranslation()
  const displayCode = useThrottledValue(data.widget_code, streaming ? THROTTLE_MS : 0)
  const finalSrcdoc = useMemo(() => buildSrcdoc(data.widget_code, data.isSVG), [data.widget_code, data.isSVG])
  const [iframeReady, setIframeReady] = useState(false)
  const [mountIframe, setMountIframe] = useState(!streaming)
  const gateNotifiedRef = useRef(false)

  useEffect(() => {
    if (streaming) { setMountIframe(false); return }
    window.app.trace?.('widget.ui', 'mount_iframe', { title: data.title })
    setMountIframe(true)
  }, [streaming, data.title])

  const handleIframeReady = useCallback(() => {
    setIframeReady(true)
    if (!gateNotifiedRef.current) {
      gateNotifiedRef.current = true
      window.app.trace?.('widget.ui', 'iframe_ready', { title: data.title })
      window.app.widgetIframeReady(data.title)
    }
  }, [data.title])

  const showShadow = streaming || !iframeReady

  const displayTitle = data.title.replace(/_/g, ' ')

  return (
    <div className="group/widget my-2 w-full">
      <div className="flex h-5 items-center justify-end gap-1.5 px-1 opacity-0 transition-opacity group-hover/widget:opacity-100">
        <span className="text-xs text-muted-foreground/70">
          {displayTitle}
        </span>
        {mountIframe && iframeReady && (
          <button
            onClick={(e) => downloadWidget(finalSrcdoc, displayTitle, e)}
            className="text-muted-foreground/70 transition-colors hover:text-foreground"
            title={t('tooltips.saveAsHtml')}
          >
            <Download className="size-3.5" />
          </button>
        )}
      </div>
      <div className="relative">
        {showShadow && (
          <ShadowWidget html={displayCode} isSVG={data.isSVG} />
        )}
        {mountIframe && (
          <AutoIframe
            srcdoc={finalSrcdoc}
            title={displayTitle}
            fallbackHeight={data.height}
            hidden={!iframeReady}
            onReady={handleIframeReady}
          />
        )}
      </div>
    </div>
  )
}
