/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'

const { openMiniAppTab, openToolUiPreviewTab } = vi.hoisted(() => ({
  openMiniAppTab: vi.fn(),
  openToolUiPreviewTab: vi.fn(),
}))
vi.mock('@/components/activity/activity-panel-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/activity/activity-panel-api')>()),
  openMiniAppTab,
  openToolUiPreviewTab,
}))

import { useChatStore } from '@/stores/chat'
import { useMiniAppStore } from '@/stores/miniapp'
import { useToolUiPreviewStore } from '@/stores/miniapp-tool-preview'
import { setCurrentSessionIdGetter } from '@/components/activity/activity-panel-api'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useAgentViewfinderStore } from '@/stores/agent-viewfinder'
import { useMiniAppPipStore } from '@/stores/miniapp-pip'
import { browserExecJs, pushBrowserConsole, readBrowserConsole } from '@/components/browser/browser-host-api'
import {
  listMiniAppTargets,
  miniAppConsoleKeys,
  miniAppTargetWebContentsId,
  pushMiniAppHostLog,
  registerMiniAppTarget,
  reloadMiniAppTargets,
  resolveMiniAppTarget,
  type MiniAppTargetHandle,
} from './miniapp-automation-targets'

/** Development is where the entry points, not the manifest flag an installed build can carry. */
function devApp(id: string, isDev = true): MiniAppEntry {
  return {
    id,
    installDir: `/apps/${id}`,
    ...(isDev ? { distDir: `/src/${id}/dist` } : {}),
    manifest: { appId: id, name: id.toUpperCase(), main: 'node.js', isDev: true },
  }
}

function fakeWebview(src = 'superone-app://tasks.p/index.html?_toolData=%7B%7D', width: number | (() => number) = 320): Electron.WebviewTag {
  const element = document.createElement('div') as unknown as Electron.WebviewTag & HTMLElement
  element.setAttribute('src', src)
  const currentWidth = () => (typeof width === 'number' ? width : width())
  Object.defineProperty(element, 'offsetWidth', { get: currentWidth })
  // On screen at the origin whenever it has a width, as a host-layer view is.
  element.getBoundingClientRect = () => {
    const w = currentWidth()
    return { left: 0, top: 0, right: w, bottom: w ? 600 : 0, width: w, height: w ? 600 : 0, x: 0, y: 0, toJSON: () => ({}) }
  }
  Object.assign(element, {
    reload: vi.fn(),
    getWebContentsId: vi.fn(() => 7),
    scrollIntoView: vi.fn(),
    executeJavaScript: vi.fn(async (script: string) => `ran:${script}`),
  })
  document.body.appendChild(element)
  return element
}

const handles: MiniAppTargetHandle[] = []

function register(targetId: string, projectDir: string, element = fakeWebview(), ready = true) {
  const handle = registerMiniAppTarget({ targetId, appId: targetId.split(':')[1], projectDir, kind: 'panel', title: 'Tasks' }, element)
  handle.setReady(ready)
  handles.push(handle)
  return { handle, element }
}

beforeEach(() => {
  openMiniAppTab.mockReset()
  openToolUiPreviewTab.mockReset()
  useChatStore.setState({
    projectSessions: {
      '/alpha': { _sessions: { 'session-a': {} } },
      '/beta': { _sessions: { 'session-b': {} } },
    },
  } as never)
  useMiniAppStore.setState({
    apps: [devApp('tasks'), devApp('store', false)],
    openApps: {
      'tasks:alpha': { instanceKey: 'tasks:alpha', entry: devApp('tasks'), projectDir: '/alpha', projectId: 'alpha', holderSessions: new Set() },
      'tasks:beta': { instanceKey: 'tasks:beta', entry: devApp('tasks'), projectDir: '/beta', projectId: 'beta', holderSessions: new Set() },
    },
  })
  useToolUiPreviewStore.setState({ previews: {} })
  useActivityPanelStore.setState({ showPanel: true })
  useAgentViewfinderStore.setState({ activeBySession: {} })
  useMiniAppPipStore.setState({ hidden: null, pipSlots: {} })
})

afterEach(() => {
  setCurrentSessionIdGetter(null)
  for (const handle of handles.splice(0)) handle.dispose()
  document.body.innerHTML = ''
})

describe('mini-app automation targets', () => {
  it('resolves a view id to the instance in the calling session’s project', async () => {
    const alpha = register('miniapp:tasks', '/alpha')
    const beta = register('miniapp:tasks', '/beta')

    const keyA = await resolveMiniAppTarget('miniapp:tasks', 'session-a')
    const keyB = await resolveMiniAppTarget('miniapp:tasks', 'session-b')

    expect(await browserExecJs(keyA, '1')).toBe('ran:1')
    expect(alpha.element.executeJavaScript).toHaveBeenCalledOnce()
    expect(keyB).not.toBe(keyA)
    expect(beta.element.executeJavaScript).not.toHaveBeenCalled()
    // Both panels are on screen already; switching tabs would take the user's focus.
    expect(openMiniAppTab).not.toHaveBeenCalled()
  })

  it('switches to an open panel that is hidden behind another tab', async () => {
    let width = 0
    openMiniAppTab.mockImplementation(() => { width = 320 })
    register('miniapp:tasks', '/alpha', fakeWebview(undefined, () => width))

    await resolveMiniAppTarget('miniapp:tasks', 'session-a')

    expect(openMiniAppTab).toHaveBeenCalledWith('tasks:alpha', 'tasks', 'TASKS', { reveal: true })
  })

  it('leaves the Activity panel closed and names the view for picture-in-picture', async () => {
    useActivityPanelStore.setState({ showPanel: false })
    let width = 0
    openMiniAppTab.mockImplementation(() => { width = 320 })
    register('miniapp:tasks', '/alpha', fakeWebview(undefined, () => width))

    await resolveMiniAppTarget('miniapp:tasks', 'session-a')

    expect(openMiniAppTab).toHaveBeenCalledWith('tasks:alpha', 'tasks', 'TASKS', { reveal: false })
    expect(useActivityPanelStore.getState().showPanel).toBe(false)
    expect(useAgentViewfinderStore.getState().activeBySession['session-a']).toEqual({ kind: 'miniapp', targetId: 'miniapp:tasks' })
  })

  it('tells the agent when the user hid the picture-in-picture', async () => {
    useActivityPanelStore.setState({ showPanel: false })
    useMiniAppPipStore.getState().hide('session-a', 'miniapp:tasks')
    register('miniapp:tasks', '/alpha', fakeWebview(undefined, 0))

    await expect(resolveMiniAppTarget('miniapp:tasks', 'session-a')).rejects.toThrow(/user hid the picture-in-picture/)
    expect(openMiniAppTab).not.toHaveBeenCalled()
  })

  it('does not treat a view parked off screen as shown', async () => {
    const element = fakeWebview()
    element.getBoundingClientRect = () => ({ left: -99999, top: 0, right: -99679, bottom: 600, width: 320, height: 600, x: -99999, y: 0, toJSON: () => ({}) })
    openMiniAppTab.mockImplementation(() => {
      element.getBoundingClientRect = () => ({ left: 0, top: 0, right: 320, bottom: 600, width: 320, height: 600, x: 0, y: 0, toJSON: () => ({}) })
    })
    register('miniapp:tasks', '/alpha', element)

    await resolveMiniAppTarget('miniapp:tasks', 'session-a')

    expect(openMiniAppTab).toHaveBeenCalledOnce()
  })

  it('opens a closed development panel instead of failing', async () => {
    const openAppInPanel = vi.fn(async () => { register('miniapp:tasks', '/alpha') })
    useMiniAppStore.setState({ openApps: {}, openAppInPanel })

    await resolveMiniAppTarget('miniapp:tasks', 'session-a')

    expect(openAppInPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'tasks' }), '/alpha', { reveal: true })
    expect(openMiniAppTab).not.toHaveBeenCalled()
  })

  it('leaves a preview that is already on screen in place, since re-activating its tab rebuilds the guest', async () => {
    useToolUiPreviewStore.setState({ previews: { 'tasks@/alpha': { key: 'tasks@/alpha', appName: 'Tasks', toolLabel: 'Run' } as never } })
    register('miniapp:tasks:preview', '/alpha')

    await resolveMiniAppTarget('miniapp:tasks:preview', 'session-a')

    expect(openToolUiPreviewTab).not.toHaveBeenCalled()
  })

  it('waits for a rebuilt guest even while the load flags still read ready', async () => {
    const element = fakeWebview()
    let attached = false
    vi.mocked(element.getWebContentsId).mockImplementation(() => {
      if (!attached) throw new Error('The WebView must be attached to the DOM and the dom-ready event emitted')
      return 7
    })
    register('miniapp:tasks', '/alpha', element)
    let resolved = false
    const pending = resolveMiniAppTarget('miniapp:tasks', 'session-a').then(() => { resolved = true })

    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(resolved).toBe(false)
    attached = true
    await pending
  })

  it('waits for the document to be ready before handing the view to a browser op', async () => {
    const { handle } = register('miniapp:tasks', '/alpha', fakeWebview(), false)
    let resolved = false
    const pending = resolveMiniAppTarget('miniapp:tasks', 'session-a').then(() => { resolved = true })

    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(resolved).toBe(false)
    handle.setReady(true)
    await pending
    expect(resolved).toBe(true)
  })

  it.each([
    ['miniapp:store', /installed, not a development app/],
    ['miniapp:tasks:preview', /Call miniapp_dev_preview first/],
    ['miniapp:tasks:tool:toolu_1', /not mounted/],
    ['miniapp:tasks:other', /Invalid mini-app view id/],
  ])('explains why %s cannot be driven', async (targetId, message) => {
    await expect(resolveMiniAppTarget(targetId, 'session-a')).rejects.toThrow(message)
  })

  it('says the view cannot be shown when it loaded but never got a layout', async () => {
    register('miniapp:tasks', '/alpha', fakeWebview(undefined, 0))
    vi.useFakeTimers()
    try {
      const pending = expect(resolveMiniAppTarget('miniapp:tasks', 'session-a')).rejects.toThrow(/loaded but not visible/)
      await vi.advanceTimersByTimeAsync(9_000)
      await pending
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a session that has no project', async () => {
    await expect(resolveMiniAppTarget('miniapp:tasks', 'unknown-session')).rejects.toThrow(/project-scoped/)
  })

  it('lists only the calling project’s views, without the payload query string', () => {
    register('miniapp:tasks:tool:toolu_1', '/alpha')
    register('miniapp:tasks', '/beta')

    expect(listMiniAppTargets('session-a')).toEqual([
      { tab: 'miniapp:tasks:tool:toolu_1', url: 'superone-app://tasks.p/index.html', title: 'Tasks', loading: false },
    ])
  })

  it('reloads every view of the app in the project and waits for them to load', async () => {
    const panel = register('miniapp:tasks', '/alpha')
    const other = register('miniapp:tasks', '/beta')
    let result: Awaited<ReturnType<typeof reloadMiniAppTargets>> | null = null
    const pending = reloadMiniAppTargets('tasks', 'session-a').then((value) => { result = value })

    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(panel.element.reload).toHaveBeenCalledOnce()
    expect(other.element.reload).not.toHaveBeenCalled()
    expect(result).toBeNull()
    panel.handle.setReady(true)
    await pending
    expect(result).toEqual({ reloadedViews: 1 })
  })

  it('reports a view it could not reload without failing the others', async () => {
    const panel = register('miniapp:tasks', '/alpha')
    const detached = register('miniapp:tasks:tool:toolu_1', '/alpha')
    detached.element.remove()
    const pending = reloadMiniAppTargets('tasks', 'session-a')

    await new Promise((resolve) => setTimeout(resolve, 60))
    panel.handle.setReady(true)

    expect(await pending).toEqual({
      reloadedViews: 1,
      notReloaded: [{ tab: 'miniapp:tasks:tool:toolu_1', error: expect.stringMatching(/not on screen/) }],
    })
    expect(detached.element.reload).not.toHaveBeenCalled()
  })

  it('never opens tabs in the layout of another session the user is viewing', async () => {
    setCurrentSessionIdGetter(() => 'session-other')
    useMiniAppStore.setState({ openApps: {}, openAppInPanel: vi.fn() })

    await expect(resolveMiniAppTarget('miniapp:tasks', 'session-a')).rejects.toThrow(/runs in the background/)
    expect(useMiniAppStore.getState().openAppInPanel).not.toHaveBeenCalled()
    expect(openMiniAppTab).not.toHaveBeenCalled()
  })

  it('lets a background session drive a view that is already on screen', async () => {
    setCurrentSessionIdGetter(() => 'session-other')
    register('miniapp:tasks', '/alpha')

    await resolveMiniAppTarget('miniapp:tasks', 'session-a')

    expect(openMiniAppTab).not.toHaveBeenCalled()
  })

  it('resolves the guest id for driver bookkeeping without revealing the view', async () => {
    register('miniapp:tasks', '/alpha', fakeWebview(undefined, 0))

    expect(await miniAppTargetWebContentsId('miniapp:tasks', 'session-a')).toBe(7)
    expect(openMiniAppTab).not.toHaveBeenCalled()
  })

  it('merges the view console with its app’s Host output in time order', () => {
    const { handle } = register('miniapp:tasks', '/alpha')
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-28T00:00:00Z'))
      pushBrowserConsole(handle.key, 'error', 'render failed')
      vi.setSystemTime(new Date('2026-09-28T00:00:01Z'))
      pushMiniAppHostLog({ appId: 'tasks', projectDir: '/alpha', level: 'error', text: 'TypeError in handler' })
      pushMiniAppHostLog({ appId: 'tasks', projectDir: '/beta', level: 'error', text: 'other project' })
    } finally {
      vi.useRealTimers()
    }

    expect(readBrowserConsole(miniAppConsoleKeys(handle.key)).map((entry) => entry.text)).toEqual([
      'render failed',
      '[host] TypeError in handler',
    ])
  })

  it('keeps Host failures when routine output overflows its buffer, and clears both on restart', () => {
    const { handle } = register('miniapp:tasks', '/alpha')
    const host = (level: 'info' | 'error', text: string, reset?: true) =>
      pushMiniAppHostLog({ appId: 'tasks', projectDir: '/alpha', level, text, ...(reset ? { reset } : {}) })
    host('error', 'activation failed')
    for (let index = 0; index < 1_000; index += 1) host('info', `tick ${index}`)

    const texts = () => readBrowserConsole(miniAppConsoleKeys(handle.key), { level: ['info', 'error'], max: 2_000 }).map((entry) => entry.text)
    expect(texts()).toContain('[host] activation failed')

    host('info', 'restarted', true)
    expect(texts()).toEqual(['[host] restarted'])
  })
})
