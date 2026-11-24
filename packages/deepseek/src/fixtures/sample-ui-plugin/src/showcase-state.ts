import { useSyncExternalStore } from 'react'

export interface ShowcaseOverrides {
  workspaceView: boolean
  transcript: boolean
  composer: boolean
  statusBar: boolean
  emptyState: boolean
  overlay: boolean
  sidebarFull: boolean
}

const DEFAULT_OVERRIDES: ShowcaseOverrides = {
  workspaceView: false,
  transcript: false,
  composer: false,
  statusBar: false,
  emptyState: true,
  overlay: false,
  sidebarFull: false,
}

let state: ShowcaseOverrides = { ...DEFAULT_OVERRIDES }
const listeners = new Set<() => void>()

export function getShowcaseOverrides(): ShowcaseOverrides {
  return state
}

export function toggleShowcaseOverride(key: keyof ShowcaseOverrides): void {
  state = { ...state, [key]: !state[key] }
  for (const listener of listeners) listener()
}

export function resetShowcaseOverrides(): void {
  state = { ...DEFAULT_OVERRIDES }
  for (const listener of listeners) listener()
}

export function subscribeShowcaseOverrides(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useShowcaseOverrides(): ShowcaseOverrides {
  return useSyncExternalStore(subscribeShowcaseOverrides, getShowcaseOverrides, getShowcaseOverrides)
}

export const SHOWCASE_SLOT_INVENTORY: ReadonlyArray<{ id: string; kind: string; scope: string }> = [
  { id: 'session.providers', kind: 'hoc', scope: 'session' },
  { id: 'session.header.actions', kind: 'list', scope: 'session (single)' },
  { id: 'workspace.view', kind: 'chain', scope: 'session' },
  { id: 'chat.transcript', kind: 'chain', scope: 'session' },
  { id: 'chat.emptyState', kind: 'chain', scope: 'session' },
  { id: 'chat.message.row', kind: 'hoc', scope: 'session' },
  { id: 'chat.message.assistant.actions', kind: 'list', scope: 'session' },
  { id: 'chat.markdown.fence', kind: 'chain', scope: 'session' },
  { id: 'chat.toolBlock', kind: 'chain', scope: 'session' },
  { id: 'chat.composer', kind: 'chain', scope: 'session' },
  { id: 'chat.composer.dock.top', kind: 'list', scope: 'session' },
  { id: 'chat.composer.toolbar.left', kind: 'list', scope: 'session' },
  { id: 'chat.composer.toolbar.right', kind: 'list', scope: 'session' },
  { id: 'chat.statusBar', kind: 'chain', scope: 'session' },
  { id: 'chat.statusBar.left', kind: 'list', scope: 'session' },
  { id: 'chat.statusBar.right', kind: 'list', scope: 'session' },
  { id: 'activity.panel', kind: 'keyed', scope: 'session' },
  { id: 'activity.launcher', kind: 'list', scope: 'session' },
  { id: 'sidebar.tabs', kind: 'list', scope: 'sidebar (harness)' },
  { id: 'sidebar.drawer', kind: 'list', scope: 'sidebar (harness)' },
  { id: 'sidebar.footer.actions', kind: 'list', scope: 'sidebar (harness)' },
  { id: 'sidebar.session.row.trailing', kind: 'list', scope: 'sidebar row (per-session)' },
  { id: 'shell.settings.pages', kind: 'list', scope: 'app' },
  { id: 'shell.overlay.items', kind: 'list', scope: 'app (harness)' },
  { id: 'shell.titlebar.content', kind: 'single', scope: 'app (harness)' },
  { id: 'shell.sidebar.content', kind: 'single', scope: 'app (harness)' },
  { id: 'shell.activity.content', kind: 'single', scope: 'app (harness)' },
]
