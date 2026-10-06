import { useRef, useState, useMemo, useLayoutEffect, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import morphdom from 'morphdom'
import { SVG_STYLES } from '@superone/shared/generative-ui/svg-styles'
import { buildWidgetSrcdoc, widgetBodyStyle, WIDGET_FRAME_WIDTH } from '@superone/shared/generative-ui/widget-srcdoc'
import type { WidgetData } from '@superone/shared/generative-ui/types'
import { Download, Bookmark } from 'lucide-react'
import { WidgetLayoutFrame } from '@superone/chat-view/WidgetLayoutFrame'
import { useChatStore } from '@/stores/chat'
import { WidgetSaveDialog } from './WidgetSaveDialog'
import { ToolIcon } from './ToolIcon'
import { EmbeddedToolBody, EmbeddedToolView } from '@superone/ui/components/ui/embedded-tool-view'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { ComposerViewBridge, type ComposerViewPorts } from '@superone/shared/composer-view-bridge'

const THROTTLE_MS = 150

const SHADOW_STYLES = `*{box-sizing:border-box}
@keyframes _fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes _pulse{0%,100%{opacity:.4}50%{opacity:.7}}
${SVG_STYLES
  .replace(/:root\s*\{/g, ':host {')
  .replace(/\.dark\s*\{/g, ':host-context(.dark) {')
  .replace(/\.dark\s+svg/g, ':host-context(.dark) svg')
  .replace(/\.dark\s+input/g, ':host-context(.dark) input')}`

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
    root.style.cssText = widgetBodyStyle(isSVG)
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

function AutoIframe({ srcdoc, title, fallbackHeight, hidden, onReady, onRequestInput, composerPorts }: {
  srcdoc: string; title: string; fallbackHeight: number; hidden?: boolean; onReady?: () => void
  onRequestInput?: (spec: unknown) => Promise<void>
  composerPorts?: ComposerViewPorts
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(fallbackHeight)
  const composer = useMemo(() => new ComposerViewBridge(composerPorts ?? {
    open: async () => { throw new Error('Input requests are unavailable in this view.') }, release: () => {},
  }), [composerPorts])
  useLayoutEffect(() => { composer.reset(); return () => composer.dispose() }, [composer, srcdoc])

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
      const source = iframeRef.current?.contentWindow
      if (typeof data.type === 'string' && composer.handle(data.type.replace(/^widget-/, ''), data, result => {
        source?.postMessage({ ...result, type: 'widget-composer-result' }, '*')
      })) return
      switch (data.type) {
        case 'widget-ready':
          composer.reset()
          postTheme()
          break
        case 'widget-resize':
          if (typeof data.height === 'number' && data.height > 0) setHeight(data.height)
          break
        case 'widget-sendPrompt':
          if (typeof data.text === 'string') useChatStore.getState().setDraftText(data.text)
          break
        case 'widget-requestInput': {
          if (typeof data.requestId !== 'string' || data.requestId.length > 128) break
          const source = iframeRef.current?.contentWindow
          const requestId = data.requestId
          void (async () => {
            try {
              if (!onRequestInput) throw new Error('Input requests are unavailable in this view.')
              await onRequestInput(data.spec)
              source?.postMessage({ type: 'widget-input-result', requestId }, '*')
            } catch (error) { source?.postMessage({ type: 'widget-input-result', requestId, error: error instanceof Error ? error.message : String(error) }, '*') }
          })()
          break
        }
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
  }, [postTheme, onRequestInput, composer])

  const handleLoad = useCallback(() => {
    onReady?.()
  }, [onReady])

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      onLoad={handleLoad}
      sandbox="allow-scripts"
      className="border-0 rounded-md"
      style={hidden
        ? { width: WIDGET_FRAME_WIDTH, height, visibility: 'hidden' as const, position: 'absolute' as const, inset: 0 }
        : { width: WIDGET_FRAME_WIDTH, height }}
      title={title}
    />
  )
}

interface WidgetBlockProps {
  data: WidgetData
  streaming?: boolean
  onRequestInput?: (spec: unknown) => Promise<void>
  composerPorts?: ComposerViewPorts
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

export function WidgetBlock({ data, streaming, onRequestInput, composerPorts }: WidgetBlockProps) {
  const { t } = useTranslation()
  const displayCode = useThrottledValue(data.widget_code, streaming ? THROTTLE_MS : 0)
  const finalSrcdoc = useMemo(() => buildWidgetSrcdoc(data.widget_code, data.isSVG), [data.widget_code, data.isSVG])
  const [iframeReady, setIframeReady] = useState(false)
  const [mountIframe, setMountIframe] = useState(!streaming)
  const [saveOpen, setSaveOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
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
    <EmbeddedToolView title={displayTitle} icon={<ToolIcon icon="widget" className="size-3 shrink-0" />}
      collapsed={collapsed} onToggleCollapsed={() => setCollapsed(value => !value)}
      expandLabel={t('tooltips.expandView')} collapseLabel={t('tooltips.collapseView')}
      actions={mountIframe && iframeReady && (
        <>
          <IconButton size="xs" variant="ghost"
            onClick={(e) => downloadWidget(finalSrcdoc, displayTitle, e)}
            tooltip={t('tooltips.saveAsHtml')}
          >
            <Download className="size-3" />
          </IconButton>
          <IconButton size="xs" variant="ghost"
            onClick={(e) => { e.stopPropagation(); setSaveOpen(true) }}
            tooltip={data.templateId ? t('widget.save.updateTitle') : t('widget.save.title')}
          >
            <Bookmark className="size-3" />
          </IconButton>
        </>
      )}>
      <EmbeddedToolBody collapsed={collapsed}>
        <WidgetLayoutFrame layout={data.layout}>
          <div className="relative">
            {showShadow && (
              <ShadowWidget html={displayCode} isSVG={data.isSVG} />
            )}
            {mountIframe && (
              <AutoIframe
                onRequestInput={onRequestInput}
                composerPorts={composerPorts}
                srcdoc={finalSrcdoc}
                title={displayTitle}
                fallbackHeight={data.height}
                hidden={!iframeReady}
                onReady={handleIframeReady}
              />
            )}
          </div>
        </WidgetLayoutFrame>
      </EmbeddedToolBody>
      {saveOpen && <WidgetSaveDialog data={data} open={saveOpen} onOpenChange={setSaveOpen} />}
    </EmbeddedToolView>
  )
}
