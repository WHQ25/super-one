/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setDockApi } from '@/components/activity/activity-panel-api'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useActivityViewStateStore } from '@/stores/activity-view-state'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { collectLeaves } from '@/components/mosaic/mosaic-tree'
import { layoutSnapshotForTarget, layoutActForTarget } from './layout-session'
import { queuedDockChanges, _resetDockOwnershipForTest } from '@/components/activity/dock-ownership'
import { useWindowMiniModeStore } from '@/stores/window-mini-mode'
import { nativeWindowLayoutFixture } from '../../../test/fixtures/native-window-layout'

const caller = { sessionId: 'A', opener: { kind: 'agent' as const }, root: '/source' }
const ref = { environmentId: 'node', sessionId: 'B' }
const target = { ref, projectPath: 'remote:route:/project', connectionId: 'route' }
const resolve = vi.fn()
const load = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window, { innerWidth: 1600, innerHeight: 1000 })
  document.body.innerHTML = '<div data-main-content></div>'
  vi.spyOn(document.querySelector('[data-main-content]')!, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 1200, height: 900 } as DOMRect)
  _resetDockOwnershipForTest()
  useActivityViewStateStore.getState()._resetForTest()
  useAppStore.setState({ view: 'main', currentFolder: '/source', experimentalRemoteNodesEnabled: true })
  useChatStore.setState({ activeProject: '/source', projectSessions: { '/source': { _activeSessionId: 'A', _sessions: {} } } as never })
  useMosaicStore.setState({ mode: 'single', root: null, focusedTileId: null, lastLayout: null })
  useWindowMiniModeStore.setState({ mode: null, phase: 'app', panelsFolded: false })
  resolve.mockResolvedValue(target)
  load.mockResolvedValue({ cwd: '/project-worktree' })
  Object.assign(window, { environment: { sessionLinkTarget: resolve, getSession: load, sessionSource: vi.fn(async () => 'desktop') } })
  Object.assign(window.app, { getWindowLayoutState: vi.fn(async () => nativeWindowLayoutFixture()) })
})

afterEach(() => setDockApi(null))

describe('cross-session layout targets', () => {
  it('returns the saved panel state for a queued action without unrelated split geometry', async () => {
    const result = await layoutActForTarget(caller, { action: 'show_panel', target: ref })
    expect(result).toMatchObject({ status: 'queued', state: { panel: { open: true, onScreen: false } } })
    expect(result).not.toHaveProperty('layout')
    expect(result.state).not.toHaveProperty('groups')
  })

  it('converts the visible remote target using its renderer project route rather than its worktree path', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    useChatStore.setState({ activeProject: target.projectPath, projectSessions: { [target.projectPath]: { _activeSessionId: 'B', _sessions: {} } } as never })
    const convert = vi.fn(async () => {})
    Object.assign(window.app, { convertWindowToMini: convert })
    const result = await layoutActForTarget(caller, { action: 'window_mode', mode: 'mini', target: ref })
    expect(result).toMatchObject({ status: 'applied', visible: true, targetSession: ref })
    expect(convert).toHaveBeenCalledWith(target.projectPath, 'B', undefined, expect.any(Array))
    expect((await layoutSnapshotForTarget(caller, ref)).window).toMatchObject({ mode: 'mini', transitioning: false })
  })

  it('skips a window conversion when its explicit target is in the background', async () => {
    const convert = vi.fn(async () => {})
    Object.assign(window.app, { convertWindowToMini: convert })
    expect(await layoutActForTarget(caller, { action: 'window_mode', mode: 'mini', target: ref })).toMatchObject({ status: 'skipped', reason: 'not_visible', targetSession: ref })
    expect(convert).not.toHaveBeenCalled()
    expect(useChatStore.getState().activeProject).toBe('/source')
  })

  it('does not leave Settings after a user navigates there while the session switch completes', async () => {
    useChatStore.setState({ switchToSession: vi.fn(async (projectPath, sessionId) => {
      useChatStore.setState({ activeProject: projectPath, projectSessions: { [projectPath]: { _activeSessionId: sessionId, _sessions: {} } } as never })
      useAppStore.setState({ view: 'settings' })
    }) })
    expect(await layoutActForTarget(caller, { action: 'focus_session', target: ref })).toMatchObject({ status: 'skipped', reason: 'superseded' })
    expect(useAppStore.getState().view).toBe('settings')
  })
  it('does not pull the user back from Settings during target preparation', async () => {
    load.mockImplementation(async () => { useAppStore.setState({ view: 'settings' }); return {} })
    expect(await layoutActForTarget(caller, { action: 'focus_session', target: ref })).toMatchObject({ status: 'skipped', reason: 'superseded' })
    expect(useAppStore.getState().view).toBe('settings')
  })
  it('splits and closes a peer on another host even when both sessions have the same id', async () => {
    useChatStore.setState({ activeProject: '/local', projectSessions: { '/local': { _activeSessionId: 'B', _sessions: {} } } as never, mountSession: vi.fn(async () => {}), unmountSession: vi.fn(), switchToSession: vi.fn(async () => {}) })
    resolve.mockImplementation(async (ref: { environmentId: string; sessionId: string }) => ({ ref, projectPath: ref.environmentId === 'node' ? target.projectPath : '/local', connectionId: ref.environmentId === 'node' ? 'route' : null }))
    const local = { environmentId: 'desktop', sessionId: 'B' }
    expect(await layoutActForTarget(caller, { action: 'split_session', target: local, sessionId: 'B', sessionEnvironmentId: 'node' })).toMatchObject({ status: 'applied' })
    expect(collectLeaves(useMosaicStore.getState().root!).map(leaf => leaf.projectPath)).toEqual(['/local', target.projectPath])
    await layoutActForTarget(caller, { action: 'close_split', target: local, sessionId: 'B', sessionEnvironmentId: 'node' })
    expect(useMosaicStore.getState().mode).toBe('single')
  })
  it('reports a disabled remote feature without changing any session layout', async () => {
    useAppStore.setState({ experimentalRemoteNodesEnabled: false })
    await expect(layoutActForTarget(caller, { action: 'focus_session', target: ref })).rejects.toThrow('Remote nodes are disabled')
    await expect(layoutActForTarget(caller, { action: 'show_panel', target: ref })).rejects.toThrow('Remote nodes are disabled')
    expect(useActivityViewStateStore.getState().perSession).toEqual({})
    expect(useChatStore.getState().activeProject).toBe('/source')
  })
  it('waits for the remote dock restore and leaves the actor running in the background', async () => {
    setDockApi({ groups: [], panels: [], hasMaximizedGroup: () => false, toJSON: () => ({ grid: { root: { type: 'branch', data: [] } } }) } as never)
    const switchToSession = vi.fn(async (projectPath: string, sessionId: string) => {
      useChatStore.setState({ activeProject: projectPath, projectSessions: { [projectPath]: { _activeSessionId: sessionId, _sessions: {} } } as never })
    })
    useChatStore.setState({ switchToSession })
    let settled = false
    const opening = layoutActForTarget(caller, { action: 'focus_session', target: ref }).then(result => { settled = true; return result })
    await vi.waitFor(() => expect(switchToSession).toHaveBeenCalledWith(target.projectPath, 'B'))
    expect(settled).toBe(false)
    useActivityViewStateStore.setState({ _currentSessionId: 'remote-session:route:B', pendingRestore: null })
    expect(await opening).toMatchObject({ status: 'applied', targetSession: ref })
    expect(await layoutActForTarget(caller, { action: 'show_panel', target: ref })).toMatchObject({ status: 'applied' })
  })

  it('abandons preparation if the user changes sessions while the target is loading', async () => {
    load.mockImplementation(async () => { useChatStore.setState({ activeProject: '/manual' }); return {} })
    expect(await layoutActForTarget(caller, { action: 'focus_session', target: ref })).toMatchObject({ status: 'skipped', reason: 'superseded' })
    expect(useChatStore.getState().activeProject).toBe('/manual')
  })

  it('isolates local and remote sessions with the same session id', async () => {
    await layoutActForTarget(caller, { action: 'show_panel', target: ref })
    resolve.mockResolvedValue({ ref: { environmentId: 'desktop', sessionId: 'B' }, projectPath: '/local', connectionId: null })
    await layoutActForTarget(caller, { action: 'hide_panel', target: { environmentId: 'desktop', sessionId: 'B' } })
    expect(useActivityViewStateStore.getState().perSession['remote-session:route:B'].showPanel).toBe(true)
    expect(useActivityViewStateStore.getState().perSession.B.showPanel).toBe(false)
  })

  it('queues a remote file in its own environment using the remote worktree root', async () => {
    const result = await layoutActForTarget(caller, { action: 'open_file', target: ref, path: '/project-worktree/report.md' })
    expect(result).toMatchObject({ status: 'queued', targetSession: ref, tab: 'file:report.md' })
    expect(queuedDockChanges('remote-session:route:B')).toHaveLength(1)
    expect(queuedDockChanges('A')).toHaveLength(0)
    expect(queuedDockChanges('B')).toHaveLength(0)
  })

  it('targets the foreground rather than the actor and reports both identities', async () => {
    useChatStore.setState({ activeProject: '/other', projectSessions: { '/other': { _activeSessionId: 'B', _sessions: {} } } as never })
    resolve.mockResolvedValue({ ref: { environmentId: 'desktop', sessionId: 'B' }, projectPath: '/other', connectionId: null })
    const snapshot = await layoutSnapshotForTarget(caller, 'foreground')
    expect(snapshot).toMatchObject({ targetSession: { environmentId: 'desktop', sessionId: 'B' }, focusedSession: { environmentId: 'desktop', sessionId: 'B' } })
    expect(resolve).toHaveBeenCalledWith({ environmentId: 'desktop', sessionId: 'B' })
  })

  it('does not fall back to a local session with a colliding id when a node is unavailable', async () => {
    resolve.mockRejectedValue(new Error('Remote host is offline'))
    await expect(layoutActForTarget(caller, { action: 'show_panel', target: ref })).rejects.toThrow('offline')
    expect(useActivityViewStateStore.getState().perSession).toEqual({})
  })

  it('requires an explicit session for foreground navigation', async () => {
    await expect(layoutActForTarget(caller, { action: 'focus_session' })).rejects.toThrow('target')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('cancels an aborted navigation before it can change the foreground', async () => {
    const controller = new AbortController()
    load.mockImplementation(async () => { controller.abort(); return {} })
    const result = await layoutActForTarget(caller, { action: 'focus_session', target: ref }, controller.signal)
    expect(result).toMatchObject({ status: 'skipped', reason: 'superseded' })
    expect(useChatStore.getState().activeProject).toBe('/source')
  })
})
