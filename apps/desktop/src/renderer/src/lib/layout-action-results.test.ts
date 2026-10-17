/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { LAYOUT_ACT_ACTIONS, type LayoutSnapshot } from '@superone/shared/layout-control'
import { layoutActionState, LAYOUT_ACTION_STATE_FIELDS } from './layout-action-results'

const snapshot: LayoutSnapshot = {
  visible: true,
  window: { visible: true, mode: 'full', transitioning: false, sidebar: 'collapsed', layout: 'single' },
  panel: { open: true, onScreen: true, side: 'right', maximized: false },
  terminal: { open: true }, chatMode: 'floating', chatPosition: 'top',
  sizes: { window: 1200, sidebar: { width: 320, min: 320, max: 500 }, panel: { width: 500, min: 400, max: 800 }, chat: { width: 0, min: 360 } },
  groups: [{ group: 0, x: 0, y: 0, width: 500, height: 800 }],
  tabs: [
    { tab: 'file:a.ts', title: 'a.ts', kind: 'file', group: 0, active: true, openedBy: 'agent' },
    { tab: 'file:b.ts', title: 'b.ts', kind: 'file', group: 0, active: false, openedBy: 'user' },
    { tab: 'file:c.ts', title: 'c.ts', kind: 'file', group: 0, active: false, openedBy: 'user' },
  ],
}
const applied = { status: 'applied' as const, visible: true }

describe('layout action result coverage', () => {
  it('defines post-action state for every public action', () => {
    expect(Object.keys(LAYOUT_ACTION_STATE_FIELDS).sort()).toEqual([...LAYOUT_ACT_ACTIONS].sort())
    for (const action of LAYOUT_ACT_ACTIONS) expect(Object.keys(layoutActionState({ action }, applied, snapshot)).length).toBeGreaterThan(0)
  })
  it('returns related and active tabs plus fresh group ids without copying unrelated tabs', () => {
    const state = layoutActionState({ action: 'move_tab', tab: 'file:b.ts' }, applied, snapshot)
    expect(state.tabs?.map(tab => tab.tab)).toEqual(['file:a.ts', 'file:b.ts'])
    expect(state.groups).toEqual(snapshot.groups)
    expect(state).not.toHaveProperty('terminal')
  })
  it('returns panel, chat and actual sizing state for their respective actions', () => {
    expect(layoutActionState({ action: 'hide_sidebar' }, applied, snapshot)).toEqual({ window: snapshot.window, sizes: snapshot.sizes })
    expect(layoutActionState({ action: 'chat_mode', mode: 'floating' }, applied, snapshot)).toMatchObject({ chatMode: 'floating', chatPosition: 'top', panel: { open: true }, sizes: snapshot.sizes })
    expect(layoutActionState({ action: 'show_terminal' }, applied, snapshot)).toEqual({ terminal: { open: true } })
  })
  it('omits visible geometry for queued changes and session-specific state after superseded navigation', () => {
    expect(layoutActionState({ action: 'move_tab', tab: 'file:b.ts' }, { status: 'queued', visible: false }, snapshot)).not.toHaveProperty('groups')
    expect(layoutActionState({ action: 'focus_session' }, { status: 'skipped', visible: false, reason: 'superseded' }, snapshot)).toEqual({ window: snapshot.window })
  })
  it('returns all target tabs after session navigation', () => {
    expect(layoutActionState({ action: 'focus_session' }, applied, snapshot).tabs).toEqual(snapshot.tabs)
  })
})
