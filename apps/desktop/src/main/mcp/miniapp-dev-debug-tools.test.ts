import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MiniAppManifest } from '@superone/shared/miniapp-types'

const { isActiveDevApp, readManifest, browserAutomationCall } = vi.hoisted(() => ({
  isActiveDevApp: vi.fn(),
  readManifest: vi.fn(),
  browserAutomationCall: vi.fn(),
}))

vi.mock('../miniapp/miniapp-service', () => ({
  getAppBasePath: (appId: string) => `/apps/${appId}`,
  isActiveDevApp,
  readManifest,
}))
vi.mock('../browser/browser-automation-bridge', () => ({ browserAutomationCall }))

const {
  miniappDevPreviewHandler,
  miniappDevReloadHandler,
  previewPhasesFor,
  setMiniAppHostReloader,
} = await import('./miniapp-dev-debug-tools')

const MANIFEST: MiniAppManifest = {
  appId: 'tasks',
  name: 'Tasks',
  main: 'node.js',
  isDev: true,
  templates: { confirm: 'confirm.html', card: 'card.html', counter: 'counter.html' },
  tools: [
    { name: 'list_tasks', description: 'List', inputSchema: { type: 'object' } },
    {
      name: 'delete_task',
      displayName: 'Delete Task',
      description: 'Delete',
      inputSchema: { type: 'object' },
      renderer: { intercept: { template: 'confirm' }, result: { template: 'card' } },
    },
    {
      name: 'increment',
      description: 'Increment',
      standalone: true,
      inputSchema: { type: 'object' },
      renderer: { result: { template: 'counter' } },
    },
  ],
}

function deps(projectPath: string | null = '/project') {
  return {
    notifyDevAppReady: vi.fn(),
    sessionId: 'session-1',
    sessionHost: { getSession: () => ({ setTitle: vi.fn(), projectPath: projectPath ?? undefined }) },
    applyAppSettings: vi.fn(),
  }
}

function text(reply: { content: Array<{ text: string }> }): string {
  return reply.content[0].text
}

beforeEach(() => {
  isActiveDevApp.mockReset().mockResolvedValue(true)
  readManifest.mockReset().mockResolvedValue(MANIFEST)
  browserAutomationCall.mockReset()
  setMiniAppHostReloader(null)
})

describe('previewPhasesFor', () => {
  it('lists the UIs chat reaches, standalone replacing result for standalone tools', () => {
    expect(previewPhasesFor(MANIFEST.tools![0])).toEqual([])
    expect(previewPhasesFor(MANIFEST.tools![1])).toEqual(['intercept', 'result'])
    expect(previewPhasesFor(MANIFEST.tools![2])).toEqual(['standalone'])
  })
})

describe('miniapp_dev_preview', () => {
  it('renders the final UI by default and returns the view id for browser tools', async () => {
    browserAutomationCall.mockResolvedValue({ target: 'miniapp:tasks:preview' })

    const reply = await miniappDevPreviewHandler({ appId: 'tasks', tool: 'delete_task', input: { id: 't1' }, result: { ok: true } }, deps())

    expect(reply.isError).toBeUndefined()
    expect(browserAutomationCall).toHaveBeenCalledWith('session-1', 'miniappPreview', {
      appId: 'tasks',
      appName: 'Tasks',
      tool: 'delete_task',
      toolLabel: 'Delete Task',
      phase: 'result',
      templatePath: 'card.html',
      input: { id: 't1' },
      result: { ok: true },
      running: false,
    })
    expect(JSON.parse(text(reply))).toMatchObject({ status: 'previewing', target: 'miniapp:tasks:preview', phase: 'result' })
  })

  it('uses the intercept template for the intercept phase', async () => {
    browserAutomationCall.mockResolvedValue({ target: 'miniapp:tasks:preview' })

    await miniappDevPreviewHandler({ appId: 'tasks', tool: 'delete_task', phase: 'intercept', width: 360 }, deps())

    expect(browserAutomationCall.mock.calls[0][2]).toMatchObject({ phase: 'intercept', templatePath: 'confirm.html', input: {}, width: 360 })
  })

  it('previews a standalone tool as standalone, including its running state', async () => {
    browserAutomationCall.mockResolvedValue({ target: 'miniapp:tasks:preview' })

    await miniappDevPreviewHandler({ appId: 'tasks', tool: 'increment', running: true }, deps())

    expect(browserAutomationCall.mock.calls[0][2]).toMatchObject({ phase: 'standalone', templatePath: 'counter.html', running: true })
  })

  it.each([
    [{ appId: 'tasks', tool: 'list_tasks' }, /no renderer to preview.*delete_task, increment/],
    [{ appId: 'tasks', tool: 'missing' }, /not declared by tasks/],
    [{ appId: 'tasks', tool: 'increment', phase: 'result' as const }, /no result UI; available phases: standalone/],
  ])('explains what can be previewed instead of rendering %o', async (args, message) => {
    const reply = await miniappDevPreviewHandler(args, deps())

    expect(reply.isError).toBe(true)
    expect(text(reply)).toMatch(message)
    expect(browserAutomationCall).not.toHaveBeenCalled()
  })

  it('refuses installed apps and sessions without a project', async () => {
    // An installed build keeps the isDev flag it was packed with; the dev registry decides.
    isActiveDevApp.mockResolvedValueOnce(false)
    expect(text(await miniappDevPreviewHandler({ appId: 'tasks', tool: 'delete_task' }, deps()))).toMatch(/not an active development app/)
    expect(text(await miniappDevPreviewHandler({ appId: 'tasks', tool: 'delete_task' }, deps(null)))).toMatch(/need a session with a project/)
    expect(browserAutomationCall).not.toHaveBeenCalled()
  })
})

describe('miniapp_dev_reload', () => {
  it('restarts the Host in the session project, then reloads the open views', async () => {
    const reloader = vi.fn().mockResolvedValue(true)
    setMiniAppHostReloader(reloader)
    browserAutomationCall.mockResolvedValue({ reloadedViews: 2 })

    const reply = await miniappDevReloadHandler({ appId: 'tasks' }, deps())

    expect(reloader).toHaveBeenCalledWith('/project', 'tasks')
    expect(browserAutomationCall).toHaveBeenCalledWith('session-1', 'miniappReload', { appId: 'tasks' })
    expect(JSON.parse(text(reply))).toEqual({ status: 'reloaded', appId: 'tasks', hostRestarted: true, reloadedViews: 2 })
  })

  it('passes on the views that could not be reloaded', async () => {
    setMiniAppHostReloader(vi.fn().mockResolvedValue(false))
    const notReloaded = [{ tab: 'miniapp:tasks:tool:toolu_1', error: 'not on screen; it loads the new code when shown' }]
    browserAutomationCall.mockResolvedValue({ reloadedViews: 0, notReloaded })

    const reply = await miniappDevReloadHandler({ appId: 'tasks' }, deps())

    expect(JSON.parse(text(reply))).toEqual({ status: 'reloaded', appId: 'tasks', hostRestarted: false, reloadedViews: 0, notReloaded })
  })

  it('does not touch an installed app', async () => {
    const reloader = vi.fn()
    setMiniAppHostReloader(reloader)
    isActiveDevApp.mockResolvedValueOnce(false)

    const reply = await miniappDevReloadHandler({ appId: 'tasks' }, deps())

    expect(reply.isError).toBe(true)
    expect(reloader).not.toHaveBeenCalled()
    expect(browserAutomationCall).not.toHaveBeenCalled()
  })
})
