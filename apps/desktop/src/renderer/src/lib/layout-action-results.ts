import type { LayoutActAction, LayoutActRequest, LayoutActResult, LayoutActState, LayoutControlCaller, LayoutControlSession, LayoutSnapshot } from '@superone/shared/layout-control'
import { layoutSnapshot } from './layout-control'

/** Every action returns only the state needed to assess it and continue arranging. */
export const LAYOUT_ACTION_STATE_FIELDS = {
  focus_session: ['window', 'panel', 'terminal', 'chatMode', 'chatPosition', 'sizes', 'tabs', 'groups'],
  split_session: ['window', 'sizes'], close_split: ['window', 'sizes'],
  maximize_split: ['window', 'sizes'], restore_splits: ['window', 'sizes'], resize_splits: ['window', 'sizes'],
  open_file: ['panel', 'tabs', 'groups', 'sizes', 'chatMode'],
  focus_tab: ['panel', 'tabs', 'groups', 'chatMode'],
  close_tab: ['panel', 'tabs', 'groups', 'chatMode', 'sizes'],
  move_tab: ['panel', 'tabs', 'groups'], resize_group: ['groups'],
  show_panel: ['panel', 'chatMode', 'sizes'], hide_panel: ['panel', 'chatMode', 'sizes'],
  maximize_panel: ['panel', 'chatMode', 'chatPosition', 'sizes', 'groups', 'tabs'],
  restore_panel: ['panel', 'chatMode', 'chatPosition', 'sizes', 'groups', 'tabs'],
  panel_side: ['panel', 'sizes'], resize_panel: ['panel', 'sizes', 'groups'],
  show_sidebar: ['window', 'sizes'], hide_sidebar: ['window', 'sizes'], resize_sidebar: ['window', 'sizes'],
  chat_mode: ['panel', 'chatMode', 'chatPosition', 'sizes'],
  window_mode: ['window', 'panel', 'chatMode', 'sizes', 'groups'],
  resize_window: ['window', 'sizes', 'groups'], enter_fullscreen: ['window', 'sizes', 'groups'], exit_fullscreen: ['window', 'sizes', 'groups'],
  show_terminal: ['terminal'], hide_terminal: ['terminal'],
} satisfies Record<LayoutActAction, (keyof LayoutActState)[]>

const NATIVE_ACTIONS = new Set<LayoutActAction>(['window_mode', 'resize_window', 'enter_fullscreen', 'exit_fullscreen'])
const GEOMETRY_ACTIONS = new Set<LayoutActAction>([
  'focus_session', 'split_session', 'close_split', 'maximize_split', 'restore_splits', 'resize_splits',
  ...NATIVE_ACTIONS, 'show_sidebar', 'hide_sidebar', 'resize_sidebar',
])

export function layoutActionState(request: LayoutActRequest, result: LayoutActResult, snapshot: LayoutSnapshot): LayoutActState {
  if (result.reason === 'superseded') return { window: snapshot.window }
  const fields = LAYOUT_ACTION_STATE_FIELDS[request.action]
  const entries = fields.filter(field => !(field === 'groups' && (result.status !== 'applied' || !snapshot.visible)) && !(field === 'sizes' && result.status === 'queued'))
    .map(field => [field, field === 'tabs' && request.action !== 'focus_session'
      ? snapshot.tabs.filter(tab => tab.active || tab.tab === result.tab || tab.tab === request.tab)
      : snapshot[field]])
  return Object.fromEntries(entries) as LayoutActState
}

export async function readLayoutSnapshot(caller: LayoutControlCaller, target?: LayoutControlSession): Promise<LayoutSnapshot> {
  const native = await window.app.getWindowLayoutState()
  const snapshot = layoutSnapshot(caller, target)
  snapshot.window.native = native
  snapshot.window.transitioning ||= native.transitioning
  return snapshot
}

export async function withLayoutActionState(caller: LayoutControlCaller, request: LayoutActRequest, result: LayoutActResult, target?: LayoutControlSession): Promise<LayoutActResult> {
  const snapshot = layoutSnapshot(caller, target)
  if (NATIVE_ACTIONS.has(request.action)) {
    snapshot.window.native = result.state?.window?.native ?? await window.app.getWindowLayoutState()
    snapshot.window.transitioning ||= snapshot.window.native.transitioning
  }
  const state = layoutActionState(request, result, snapshot)
  // Split topology and viewport changes need fresh divider ids, geometry and capacity.
  // Tab/terminal/panel-only operations no longer repeat an unrelated session tree.
  const layout = result.layout ?? (GEOMETRY_ACTIONS.has(request.action) ? await (await import('./layout-mosaic')).sessionLayoutSnapshot() : undefined)
  return { ...result, state, ...(layout ? { layout } : {}) }
}
