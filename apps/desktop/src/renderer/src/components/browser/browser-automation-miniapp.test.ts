/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'

vi.mock('@/components/activity/activity-panel-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/activity/activity-panel-api')>()),
  openMiniAppTab: vi.fn(),
  openBrowserTab: vi.fn(),
}))

const { startBrowserRecording } = vi.hoisted(() => ({ startBrowserRecording: vi.fn() }))
vi.mock('./browser-recording', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./browser-recording')>()),
  startBrowserRecording,
}))

import { openBrowserTab } from '@/components/activity/activity-panel-api'
import { useAgentViewfinderStore } from '@/stores/agent-viewfinder'
import { useBrowserStore } from '@/stores/browser'
import { useChatStore } from '@/stores/chat'
import { useMiniAppStore } from '@/stores/miniapp'
import { pushMiniAppHostLog, registerMiniAppTarget, type MiniAppTargetHandle } from '@/components/miniapp/miniapp-automation-targets'
import { pushBrowserConsole, registerBrowserWebview } from './browser-host-api'
import { runBrowserOp } from './browser-automation-runtime'

const APP: MiniAppEntry = { id: 'tasks', installDir: '/apps/tasks', distDir: '/src/tasks/dist', manifest: { appId: 'tasks', name: 'Tasks', main: 'node.js', isDev: true } }

let handle: MiniAppTargetHandle
let element: Electron.WebviewTag

beforeEach(() => {
  useChatStore.setState({ projectSessions: { '/alpha': { _sessions: { 'session-a': {} } } } } as never)
  useMiniAppStore.setState({
    apps: [APP],
    openApps: { 'tasks:alpha': { instanceKey: 'tasks:alpha', entry: APP, projectDir: '/alpha', projectId: 'alpha', holderSessions: new Set() } },
  })
  useBrowserStore.setState({ tabs: {}, automationCounts: {} } as never)
  useAgentViewfinderStore.setState({ activeBySession: {} })
  element = document.createElement('div') as unknown as Electron.WebviewTag
  element.setAttribute('src', 'superone-app://tasks.alpha/index.html')
  Object.defineProperty(element, 'offsetWidth', { get: () => 320 })
  element.getBoundingClientRect = () => ({ left: 0, top: 0, right: 320, bottom: 600, width: 320, height: 600, x: 0, y: 0, toJSON: () => ({}) })
  Object.assign(element, {
    reload: vi.fn(),
    getWebContentsId: vi.fn(() => 7),
    executeJavaScript: vi.fn(async () => ({ title: 'Tasks', elements: [] })),
  })
  document.body.appendChild(element as unknown as HTMLElement)
  handle = registerMiniAppTarget({ targetId: 'miniapp:tasks', appId: 'tasks', projectDir: '/alpha', kind: 'panel', title: 'Tasks' }, element)
  handle.setReady(true)
})

afterEach(() => {
  handle.dispose()
  document.body.innerHTML = ''
  vi.mocked(openBrowserTab).mockReset()
})

describe('browser ops on a mini-app view', () => {
  it('snapshots the view with its own and its Host’s console, leaving browser tab state alone', async () => {
    pushBrowserConsole(handle.key, 'error', 'render failed')
    pushMiniAppHostLog({ appId: 'tasks', projectDir: '/alpha', level: 'error', text: 'tool crashed' })

    const page = await runBrowserOp('session-a', 'snapshot', { tab: 'miniapp:tasks', include: ['meta', 'console'] }) as {
      title: string
      console: Array<{ text: string }>
    }

    expect(page.title).toBe('Tasks')
    expect(page.console.map((entry) => entry.text)).toEqual(['render failed', '[host] tool crashed'])
    expect(useBrowserStore.getState().tabs).toEqual({})
    expect(useBrowserStore.getState().automationCounts).toEqual({})
    // The viewfinder names the mini-app view (for its picture-in-picture), never a browser tab.
    expect(useAgentViewfinderStore.getState().activeBySession).toEqual({ 'session-a': { kind: 'miniapp', targetId: 'miniapp:tasks' } })
  })

  it('lists mini-app views next to browser tabs', async () => {
    expect(await runBrowserOp('session-a', 'tabs', {})).toEqual({
      tabs: [{ tab: 'miniapp:tasks', url: 'superone-app://tasks.alpha/index.html', title: 'Tasks', loading: false }],
      count: 1,
    })
  })

  it('never turns a mini-app view id into a browser tab', async () => {
    await expect(runBrowserOp('session-a', 'open', { tab: 'miniapp:tasks', url: 'https://example.com' })).rejects.toThrow(/mini-app view/)
    await expect(runBrowserOp('session-a', 'close', { tab: 'miniapp:tasks' })).rejects.toThrow(/mini-app view/)
    expect(openBrowserTab).not.toHaveBeenCalled()
  })

  it('reloads the view for navigate reload and refuses URL navigation', async () => {
    await expect(runBrowserOp('session-a', 'navigate', { tab: 'miniapp:tasks', url: 'https://example.com' })).rejects.toThrow(/only action "reload"/)

    const pending = runBrowserOp('session-a', 'navigate', { tab: 'miniapp:tasks', action: 'reload' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(element.reload).toHaveBeenCalledOnce()
    handle.setReady(true)
    await expect(pending).resolves.toEqual({ ok: true, action: 'reload', tab: 'miniapp:tasks' })
  })

  it('reports how many views miniapp_dev_reload reloaded', async () => {
    const pending = runBrowserOp('session-a', 'miniappReload', { appId: 'tasks' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    handle.setReady(true)
    await expect(pending).resolves.toEqual({ reloadedViews: 1 })
  })

  it('records the view and keeps the agent-facing id for the actions that follow', async () => {
    startBrowserRecording.mockResolvedValue({ recordingId: 'rec-1', tab: handle.key })

    await expect(runBrowserOp('session-a', 'recordStart', { tab: 'miniapp:tasks' }))
      .resolves.toEqual({ recordingId: 'rec-1', tab: 'miniapp:tasks' })
    expect(startBrowserRecording).toHaveBeenCalledWith(handle.key, undefined)
  })

  it('emulates a viewport on the view and clears it with the view', async () => {
    await runBrowserOp('session-a', 'emulateViewport', { tab: 'miniapp:tasks', width: 390, height: 844 })
    expect(useBrowserStore.getState().emulations[handle.key]).toEqual({ width: 390, height: 844 })

    handle.dispose()
    expect(useBrowserStore.getState().emulations[handle.key]).toBeUndefined()
  })

  it('resolves the guest id for a CDP driver without revealing the view', async () => {
    const openMiniAppTab = vi.mocked((await import('@/components/activity/activity-panel-api')).openMiniAppTab)
    openMiniAppTab.mockClear()

    await expect(runBrowserOp('session-a', 'resolveWebContentsId', { tab: 'miniapp:tasks' })).resolves.toEqual({ webContentsId: 7 })
    expect(openMiniAppTab).not.toHaveBeenCalled()
  })
})

describe('browser ops on a browser tab', () => {
  it('holds the automation presentation until the op settles', async () => {
    let finish: (value: unknown) => void = () => {}
    const tab = document.createElement('div') as unknown as Electron.WebviewTag
    Object.assign(tab, { executeJavaScript: vi.fn(() => new Promise((resolve) => { finish = resolve })) })
    const unregister = registerBrowserWebview('browser-1', tab)
    useBrowserStore.setState({ tabs: { 'browser-1': { url: 'https://example.com', title: '', loading: false, owner: 'session-a' } } } as never)
    try {
      const pending = runBrowserOp('session-a', 'query', { tab: 'browser-1', selector: 'body' })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(useBrowserStore.getState().automationCounts['browser-1']).toBe(1)

      finish({ matches: [] })
      await pending
      expect(useBrowserStore.getState().automationCounts['browser-1']).toBeUndefined()
    } finally {
      unregister()
    }
  })
})
