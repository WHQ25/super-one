import { create } from 'zustand'
import type { ReactNode } from 'react'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { McpAppDesktopApi, McpAppRoute } from './desktop-executor'

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
  renderFallback?: (trailing: ReactNode) => ReactNode
}
interface FrameOwner { iframe: HTMLIFrameElement; revoke(): void; failed: boolean }
const frames = new Map<string, FrameOwner>()
const surfaces = new Map<string, Partial<Record<McpAppSurface, HTMLElement>>>()
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
  const mode = useMcpAppLayout.getState().views[key]?.mode
  const target = mode && surfaces.get(key)?.[mode]
  const parent = !park && target?.isConnected ? target : parkingContainer()
  if (!frame.iframe.isConnected || !parent.isConnected || frame.iframe.ownerDocument !== parent.ownerDocument) { invalidMove(frame); return }
  if (frame.iframe.parentNode !== parent) parent.moveBefore(frame.iframe, null)
}

interface McpAppLayoutState {
  views: Record<string, McpAppOwner>
  claim(owner: Omit<McpAppOwner, 'mode'>): () => void
  setMode(key: string, mode: McpAppSurface): void
  surface(key: string, mode: McpAppSurface, element: HTMLElement | null): void
  frame(key: string, iframe: HTMLIFrameElement, revoke: () => void): () => void
  clear(): void
}

/** Owns the document independently of transcript rows, including virtualization. */
export const useMcpAppLayout = create<McpAppLayoutState>((set, get) => ({
  views: {},
  claim(owner) {
    const key = owner.app.appInstanceId
    set(state => ({ views: { ...state.views, [key]: { ...owner, mode: state.views[key]?.mode ?? 'inline' } } }))
    return () => {
      if (get().views[key]?.row !== owner.row) return
      get().surface(key, 'inline', null)
      set(state => ({ views: { ...state.views, [key]: { ...state.views[key]!, row: null } } }))
      // React StrictMode can immediately reclaim the row; do not replace its bridge.
      queueMicrotask(() => {
        if (get().views[key]?.row || get().views[key]?.mode !== 'inline') return
        set(state => { const views = { ...state.views }; delete views[key]; return { views } })
        surfaces.delete(key)
      })
    }
  },
  setMode(key, mode) {
    const owner = get().views[key]
    if (!owner) return
    // Park synchronously before React can remove the previous surface.
    move(key, true)
    if (mode === 'inline' && !owner.row) {
      get().surface(key, owner.mode, null)
      set(state => { const views = { ...state.views }; delete views[key]; return { views } })
      surfaces.delete(key)
    } else {
      set(state => ({ views: { ...state.views, [key]: { ...owner, mode } } }))
      move(key)
    }
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
  clear() { set({ views: {} }); surfaces.clear() },
}))
