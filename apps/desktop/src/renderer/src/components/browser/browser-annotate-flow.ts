import { useChatStore } from '@/stores/chat'
import { browserExecJs, browserCapture } from './browser-host-api'
import {
  buildAnnotateScript,
  ANNOTATE_HIDE_AND_WAIT_SCRIPT,
  ANNOTATE_SHOW_SCRIPT,
  type AnnotateConfig,
  type AnnotateMessage,
} from './browser-annotate-script'

export interface AnnotateLabels {
  placeholder: string
  confirm: string
  cancel: string
  screenshot: string
  sColor: string
  sBg: string
  sSize: string
  sWeight: string
  sRadius: string
  sPadding: string
}

function readTheme(): Omit<AnnotateConfig, keyof AnnotateLabels> {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  const primary = v('--primary', 'oklch(0.62 0.19 40)')
  return {
    primary,
    fill: `color-mix(in oklab, ${primary} 14%, transparent)`,
    bg: v('--popover', '#ffffff'),
    fg: v('--popover-foreground', '#111111'),
    border: v('--border', 'rgba(0,0,0,0.12)'),
    mutedFg: v('--muted-foreground', '#666666'),
  }
}

export function buildSessionScript(labels: AnnotateLabels): string {
  const config: AnnotateConfig = { ...readTheme(), ...labels }
  return buildAnnotateScript(config)
}

function isAnnotateMessage(value: unknown): value is AnnotateMessage {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Record<string, unknown>
  if (m.op !== 'commit' && m.op !== 'update' && m.op !== 'delete') return false
  if (typeof m.id !== 'string') return false
  if (m.op === 'delete') return true
  if (m.kind !== 'element' && m.kind !== 'region') return false
  const rect = m.rect as Record<string, unknown> | undefined
  if (!rect || ['x', 'y', 'width', 'height'].some((k) => typeof rect[k] !== 'number')) return false
  if (!Array.isArray(m.styleChanges)) return false
  return typeof m.comment === 'string'
}

async function captureClean(browserId: string, rect: AnnotateMessage['rect']): Promise<string | null> {
  const r = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
  if (r.width <= 0 || r.height <= 0) return null
  await browserExecJs(browserId, ANNOTATE_HIDE_AND_WAIT_SCRIPT)
  let base64: string | null = null
  try {
    const img = await browserCapture(browserId, r)
    if (img && !img.isEmpty()) base64 = img.toDataURL().split(',')[1] ?? null
  } finally {
    void browserExecJs(browserId, ANNOTATE_SHOW_SCRIPT)
  }
  return base64
}

export async function handleAnnotationMessage(browserId: string, payload: unknown): Promise<void> {
  if (!isAnnotateMessage(payload)) return
  const store = useChatStore.getState()
  if (payload.op === 'delete') {
    store.removeBrowserAnnotation(payload.id)
    return
  }
  if (payload.op === 'update') {
    const screenshot = payload.wantScreenshot ? await captureClean(browserId, payload.rect) : null
    store.updateBrowserAnnotation(payload.id, {
      comment: payload.comment,
      styleChanges: payload.styleChanges,
      screenshot,
    })
    return
  }
  const screenshot = payload.wantScreenshot ? await captureClean(browserId, payload.rect) : null
  store.addBrowserAnnotation({
    id: payload.id,
    kind: payload.kind,
    selector: payload.selector,
    comment: payload.comment,
    pageUrl: payload.pageUrl,
    pageTitle: payload.pageTitle,
    screenshot,
    styleChanges: payload.styleChanges,
  })
}

export function notifyAnnotationRemoved(browserId: string, id: string): void {
  void browserExecJs(browserId, `window.__superoneAnnotateRemoveMark && window.__superoneAnnotateRemoveMark(${JSON.stringify(id)})`)
}

export function notifyAnnotationsCleared(browserId: string): void {
  void browserExecJs(browserId, 'window.__superoneAnnotateClearMarks && window.__superoneAnnotateClearMarks()')
}
