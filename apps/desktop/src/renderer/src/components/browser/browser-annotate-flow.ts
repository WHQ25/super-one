import { useChatStore } from '@/stores/chat'
import { browserTabCanvas, useBrowserStore, type AnnotateQuickMode } from '@/stores/browser'
import { findSessionTarget, getScopedPerSession } from '@/stores/chat-store/helpers/store-helpers'
import type { SessionWriteTarget } from '@/stores/chat-store/types'
import { browserExecJs, browserCapture } from './browser-host-api'
import { flattenBrowserCapture } from './browser-canvas'
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

function readTheme(): Pick<AnnotateConfig, 'primary' | 'fill' | 'bg' | 'fg' | 'border' | 'mutedFg'> {
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

export function buildSessionScript(labels: AnnotateLabels, quick: AnnotateQuickMode | null = null): string {
  const config: AnnotateConfig = { ...readTheme(), ...labels, quick: quick != null, quickShot: quick === 'shot' }
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
    if (img && !img.isEmpty()) {
      base64 = (await flattenBrowserCapture(img, browserTabCanvas(browserId))).split(',')[1] ?? null
    }
  } finally {
    void browserExecJs(browserId, ANNOTATE_SHOW_SCRIPT)
  }
  return base64
}

/**
 * Marks belong to the session that owns the tab, which need not be the one this
 * window shows — its composer may be open in a mini window instead.
 */
function annotationTarget(browserId: string): SessionWriteTarget | undefined {
  const owner = useBrowserStore.getState().tabs[browserId]?.owner
  return (owner && findSessionTarget(useChatStore.getState(), owner)) || undefined
}

export async function handleAnnotationMessage(browserId: string, payload: unknown): Promise<void> {
  if (!isAnnotateMessage(payload)) return
  const store = useChatStore.getState()
  const target = annotationTarget(browserId)
  if (payload.op === 'delete') {
    store.removeBrowserAnnotation(payload.id, target)
    return
  }
  if (payload.op === 'update') {
    const screenshot = payload.wantScreenshot ? await captureClean(browserId, payload.rect) : null
    store.updateBrowserAnnotation(payload.id, {
      comment: payload.comment,
      styleChanges: payload.styleChanges,
      screenshot,
    }, target)
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
  }, target)
}

/**
 * Drop a page mark once its chip leaves the composer, however that happens: its
 * ×, a send, or the same session's composer in another window.
 */
export function watchAnnotationMarks(browserId: string): () => void {
  const store = useChatStore.getState()
  const activeSessionId = store.activeProject ? store.projectSessions[store.activeProject]?._activeSessionId : null
  const target = annotationTarget(browserId)
    ?? (store.activeProject && activeSessionId ? { projectPath: store.activeProject, sessionId: activeSessionId } : undefined)
  let previous = getScopedPerSession(store, target).browserAnnotations
  return useChatStore.subscribe((state) => {
    const next = getScopedPerSession(state, target).browserAnnotations
    if (next === previous) return
    const kept = new Set(next.map((annotation) => annotation.id))
    for (const { id } of previous) {
      if (!kept.has(id)) void browserExecJs(browserId, `window.__superoneAnnotateRemoveMark && window.__superoneAnnotateRemoveMark(${JSON.stringify(id)})`)
    }
    previous = next
  })
}
