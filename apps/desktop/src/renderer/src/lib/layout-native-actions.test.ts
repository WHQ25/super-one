/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutActRequest } from '@superone/shared/layout-control'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { useWindowMiniModeStore } from '@/stores/window-mini-mode'
import { layoutActForTarget, layoutSnapshotForTarget } from './layout-session'
import { nativeWindowLayoutFixture as native } from '../../../test/fixtures/native-window-layout'

const project = '/window-qa'
const ref = { environmentId: 'desktop', sessionId: 'visible' }
const caller = { sessionId: 'background', environmentId: 'desktop', opener: { kind: 'agent' as const } }

beforeEach(() => {
  Object.defineProperties(window, { innerWidth: { value: 1200, configurable: true }, innerHeight: { value: 900, configurable: true } })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  useAppStore.setState({ view: 'main', showSidebar: false, currentFolder: project })
  useChatStore.setState({ activeProject: project, projectSessions: { [project]: { _activeSessionId: ref.sessionId, _sessions: { [ref.sessionId]: {} } } } as never })
  useMosaicStore.setState({ mode: 'single', root: null, focusedTileId: null, lastLayout: null })
  useWindowMiniModeStore.setState({ mode: null, phase: 'app', panelsFolded: false })
  Object.assign(window.environment, {
    sessionLinkTarget: vi.fn(async target => ({ ref: target, projectPath: project, connectionId: null })),
    getSession: vi.fn(async () => ({ cwd: project })), sessionSource: vi.fn(async () => 'desktop'),
  })
  Object.assign(window.app, {
    getWindowLayoutState: vi.fn(async () => native()),
    resizeWindow: vi.fn(async () => native()),
    setWindowFullscreen: vi.fn(async fullscreen => ({ ...native(), fullscreen })),
  })
})

describe('agent native window actions', () => {
  it('returns the applied native dimensions, constraints and current viewport capacity', async () => {
    const result = await layoutActForTarget(caller, { action: 'resize_window', target: ref, width: 9999, height: 900 })
    expect(window.app.resizeWindow).toHaveBeenCalledWith({ width: 9999, height: 900 })
    expect(result).toMatchObject({ status: 'applied', targetSession: ref, width: 1200, height: 900, state: { window: { native: native() }, sizes: { window: 1200 } }, layout: { mode: 'single' } })
  })
  it('returns explicit fullscreen state for both directions without a follow-up snapshot', async () => {
    expect(await layoutActForTarget(caller, { action: 'enter_fullscreen', target: ref })).toMatchObject({ state: { window: { native: { fullscreen: true } } } })
    expect(await layoutActForTarget(caller, { action: 'exit_fullscreen', target: ref })).toMatchObject({ state: { window: { native: { fullscreen: false } } } })
    expect((await layoutSnapshotForTarget(caller, ref)).window.native).toEqual(native())
  })
  it('skips background targets and refuses invalid sizes or mini-window fullscreen before native mutations', async () => {
    for (const request of [{ action: 'resize_window', width: 900 }, { action: 'enter_fullscreen' }, { action: 'exit_fullscreen' }] as LayoutActRequest[]) {
      expect(await layoutActForTarget(caller, request)).toMatchObject({ status: 'skipped', reason: 'not_visible', state: { window: { native: native() } } })
    }
    for (const request of [{ action: 'resize_window' }, { action: 'resize_window', height: -1 }, { action: 'resize_window', width: NaN }] as LayoutActRequest[]) {
      await expect(layoutActForTarget(caller, { ...request, target: ref })).rejects.toMatchObject({ code: 'invalid' })
    }
    useWindowMiniModeStore.setState({ phase: 'mini', mode: { projectPath: project, sessionId: ref.sessionId }, panelsFolded: true })
    await expect(layoutActForTarget(caller, { action: 'enter_fullscreen', target: ref })).rejects.toThrow('window_mode')
    expect(window.app.resizeWindow).not.toHaveBeenCalled()
    expect(window.app.setWindowFullscreen).not.toHaveBeenCalled()
  })

  it('finishes an applied native change if the user backgrounds the window before rendering resumes', async () => {
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.mocked(window.app.resizeWindow).mockImplementation(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      return native()
    })
    try {
      expect(await layoutActForTarget(caller, { action: 'resize_window', target: ref, width: 900 })).toMatchObject({ status: 'applied', visible: false })
    } finally { frame.mockRestore() }
  })
})
