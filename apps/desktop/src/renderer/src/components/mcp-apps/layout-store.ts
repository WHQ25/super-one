import { create } from 'zustand'
import type { ReactNode } from 'react'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { McpAppDesktopApi, McpAppRoute } from './desktop-executor'
import { syncMcpAppTab } from '@/components/activity/mcp-app-tabs'

export type McpAppSurface = 'inline' | 'fullscreen' | 'pip'
export interface McpAppOwner {
  app: ToolAppAttachment
  route: McpAppRoute
  api: McpAppDesktopApi
  row: HTMLElement | null
  mode: McpAppSurface
  title?: string
  toolName?: string
  details?: ReactNode
  /** A View the host opened outside the transcript: it has no inline row and closes with its tab. */
  onClose?: () => void
}
interface FrameOwner { iframe: HTMLIFrameElement; revoke(): void; failed: boolean }
const frames = new Map<string, FrameOwner>()
const surfaces = new Map<string, Partial<Record<McpAppSurface, HTMLElement>>>()
const claims = new Map<string, Map<symbol, Omit<McpAppOwner, 'mode'>>>()
function visibleRow(row: HTMLElement | null): row is HTMLElement {
  if (!row?.isConnected) return false
  const container = row.closest<HTMLElement>('[data-chat-root]') ?? row
  const bounds = container.getBoundingClientRect()
  return bounds.width > 0 && bounds.height > 0 && container.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
}
function refreshClaim(key: string): void {
  const state = useMcpAppLayout.getState()
  const owner = state.views[key]
  if (!owner) return
  const visible = [...(claims.get(key)?.values() ?? [])].filter(value => visibleRow(value.row))
  const selected = visible.find(value => !value.row!.closest('[data-chat-panel]')) ?? visible[0]
  const row = selected?.row ?? null
  if (owner.row !== row || (selected && (owner.app !== selected.app || owner.route !== selected.route || owner.api !== selected.api || owner.details !== selected.details || owner.title !== selected.title || owner.toolName !== selected.toolName))) {
    move(key, true)
    useMcpAppLayout.setState(current => ({ views: { ...current.views, [key]: { ...(selected ?? owner), row, mode: owner.mode } } }))
  }
  move(key)
}
let parking: HTMLDivElement | undefined
function parkingContainer(): HTMLDivElement {
  if (!parking?.isConnected) {
    parking = document.createElement('div'); parking.hidden = true
    parking.dataset.mcpAppParking = ''; document.body.appendChild(parking)
  }
  return parking
}
function invalidMove(frame: FrameOwner): void {
  if (frame.failed) return
  frame.failed = true
  console.warn('[MCP App] Atomic move requires connected nodes in the same document; restarting this View is required')
  frame.revoke()
}

/** All moves are between connected nodes: detach/append would reload the document. */
function move(key: string, park = false): void {
  const frame = frames.get(key)
  if (!frame || frame.failed) return
  const owner = useMcpAppLayout.getState().views[key]
  const mode = owner?.mode
  const target = mode && surfaces.get(key)?.[mode]
  const inlineVisible = mode !== 'inline' || (visibleRow(owner?.row ?? null) && owner!.row!.contains(target ?? null))
  const parent = !park && inlineVisible && target?.isConnected ? target : parkingContainer()
  if (!frame.iframe.isConnected || !parent.isConnected || frame.iframe.ownerDocument !== parent.ownerDocument) { invalidMove(frame); return }
  if (frame.iframe.parentNode !== parent) {
    try { parent.moveBefore(frame.iframe, null) } catch { invalidMove(frame) }
  }
}

export function parkMcpAppFullscreenFrames(): void {
  for (const [key, owner] of Object.entries(useMcpAppLayout.getState().views)) if (owner.mode === 'fullscreen') move(key, true)
}
export function resumeMcpAppFullscreenFrames(): void {
  for (const [key, owner] of Object.entries(useMcpAppLayout.getState().views)) if (owner.mode === 'fullscreen') move(key)
}

interface McpAppLayoutState {
  views: Record<string, McpAppOwner>
  claim(owner: Omit<McpAppOwner, 'mode'>): () => void
  /** Show a host-opened View (`onClose` set) in its own activity tab. */
  openHost(owner: Omit<McpAppOwner, 'mode' | 'row'> & { onClose: () => void }, maximized?: boolean): void
  /** `maximized` applies to the fullscreen activity tab only. */
  setMode(key: string, mode: McpAppSurface, maximized?: boolean): void
  surface(key: string, mode: McpAppSurface, element: HTMLElement | null): void
  frame(key: string, iframe: HTMLIFrameElement, revoke: () => void): () => void
  clear(): void
}

/** Owns the document independently of transcript rows, including virtualization. */
export const useMcpAppLayout = create<McpAppLayoutState>((set, get) => ({
  views: {},
  claim(owner) {
    const key = owner.app.appInstanceId
    const token = Symbol(key)
    const rows = claims.get(key) ?? new Map()
    rows.set(token, owner); claims.set(key, rows)
    if (!get().views[key]) set(state => ({ views: { ...state.views, [key]: { ...owner, row: null, mode: 'inline' } } }))
    const container = owner.row?.closest<HTMLElement>('[data-chat-root]') ?? owner.row
    const resize = new ResizeObserver(() => refreshClaim(key))
    if (container) resize.observe(container)
    const mutation = new MutationObserver(() => refreshClaim(key))
    for (let element = container; element; element = element.parentElement) mutation.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] })
    refreshClaim(key)
    return () => {
      resize.disconnect(); mutation.disconnect()
      rows.delete(token)
      if (claims.get(key) !== rows) return
      if (rows.size === 0) claims.delete(key)
      if (get().views[key]?.row !== owner.row) return
      move(key, true)
      set(state => ({ views: { ...state.views, [key]: { ...state.views[key]!, row: null } } }))
      refreshClaim(key)
      // A props update or StrictMode can reclaim the same row immediately. Its
      // stable surface ref will not fire again, so retain that destination.
      queueMicrotask(() => {
        if (get().views[key]?.row || claims.get(key)?.size) return
        get().surface(key, 'inline', null)
        if (get().views[key]?.mode !== 'inline') return
        set(state => { const views = { ...state.views }; delete views[key]; return { views } })
        surfaces.delete(key)
      })
    }
  },
  openHost(owner, maximized = false) {
    const key = owner.app.appInstanceId
    if (!get().views[key]) set(state => ({ views: { ...state.views, [key]: { ...owner, row: null, mode: 'fullscreen' } } }))
    syncMcpAppTab(key, 'fullscreen', maximized)
  },
  setMode(key, mode, maximized = true) {
    const owner = get().views[key]
    if (!owner) return
    if (owner.onClose && mode === 'inline') {
      // A host-opened View has no row to return to: leaving its tab closes it.
      move(key, true)
      syncMcpAppTab(key, 'inline')
      set(state => { const views = { ...state.views }; delete views[key]; return { views } })
      surfaces.delete(key)
      owner.onClose()
      return
    }
    // Park synchronously before React can remove the previous surface.
    move(key, true)
    set(state => ({ views: { ...state.views, [key]: { ...owner, mode } } }))
    syncMcpAppTab(key, mode, maximized)
    refreshClaim(key)
  },
  surface(key, mode, element) {
    const targets = surfaces.get(key) ?? {}
    if (element) targets[mode] = element; else delete targets[mode]
    surfaces.set(key, targets)
    if (element) move(key)
    else {
      // Never move from ref detach: a disconnected source cannot preserve state.
      const frame = frames.get(key)
      if (frame && !frame.iframe.isConnected) invalidMove(frame)
    }
  },
  frame(key, iframe, revoke) {
    parkingContainer().appendChild(iframe) // Initial insertion, before setting src.
    const owner = { iframe, revoke, failed: false }
    frames.set(key, owner)
    move(key)
    return () => {
      if (frames.get(key) === owner) frames.delete(key)
      iframe.remove()
    }
  },
  clear() {
    for (const key of Object.keys(get().views)) get().setMode(key, 'inline')
    set({ views: {} }); surfaces.clear(); claims.clear()
  },
}))
