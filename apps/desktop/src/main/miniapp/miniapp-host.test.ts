import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { children, fork, closeMiniAppStatePaths, handleMiniAppStateRequest } = vi.hoisted(() => ({
  children: [] as FakeUtilityProcess[],
  fork: vi.fn(),
  closeMiniAppStatePaths: vi.fn(),
  handleMiniAppStateRequest: vi.fn(),
}))

/**
 * Mirrors Electron: `pid` stays undefined until the child has spawned. The host
 * must not read it as a liveness signal — see the concurrent-start case below.
 */
class FakeUtilityProcess extends EventEmitter {
  pid: number | undefined = undefined
  postMessage = vi.fn()
  kill = vi.fn(() => {
    this.pid = undefined
    this.emit('exit', 0)
    return true
  })
  stdout = new EventEmitter()
  stderr = new EventEmitter()

  spawn(pid = 42): void {
    this.pid = pid
  }

  exit(code = 0): void {
    this.pid = undefined
    this.emit('exit', code)
  }
}

vi.mock('electron', () => ({
  app: { getVersion: () => '9.9.9' },
  utilityProcess: {
    fork: (...args: unknown[]) => fork(...args),
  },
}))

vi.mock('fs', () => ({ mkdirSync: vi.fn() }))

vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('./miniapp-state', () => ({ closeMiniAppStatePaths, handleMiniAppStateRequest }))

const host = await import('./miniapp-host')

const START = {
  appId: 'demo',
  projectDir: '/project',
  name: 'Demo',
  appPath: '/apps/demo',
  entryPath: '/apps/demo/node.js',
  background: false,
  workspaceStoragePath: '/project/.superone/apps/demo/data',
  globalStoragePath: '/home/.superone/apps/demo/data',
}

function child(): FakeUtilityProcess {
  return children.at(-1)!
}

describe('mini-app MiniApp Host', () => {
  beforeEach(() => {
    children.length = 0
    closeMiniAppStatePaths.mockReset()
    handleMiniAppStateRequest.mockReset()
    fork.mockReset().mockImplementation(() => {
      const value = new FakeUtilityProcess()
      children.push(value)
      return value
    })
    host.initMiniAppHost(() => null, () => 'en')
  })

  afterEach(() => {
    host.stopAllMiniAppHosts()
  })

  it('starts one utility process per project and app', async () => {
    const first = host.startMiniAppHost(START)
    child().spawn()
    const second = host.startMiniAppHost(START)

    expect(second).toEqual(first)
    expect(fork).toHaveBeenCalledTimes(1)
    expect(host.listMiniAppHosts()).toEqual([
      expect.objectContaining({ appId: 'demo', projectDir: '/project', name: 'Demo' }),
    ])
  })

  it('does not fork a second process for a host that has not spawned yet', async () => {
    host.startMiniAppHost(START)
    // No spawn(): pid is still undefined, exactly as Electron reports it here.
    host.startMiniAppHost(START)

    expect(fork).toHaveBeenCalledTimes(1)
    expect(host.listMiniAppHosts()).toHaveLength(1)
  })

  it('lists a host that is still starting so the sidebar can show it', () => {
    host.startMiniAppHost(START)

    expect(host.listMiniAppHosts()).toEqual([expect.objectContaining({ appId: 'demo', ready: false })])
  })

  it('respawns a host that died on its own when a tool is called', async () => {
    host.startMiniAppHost(START)
    child().exit(1)
    expect(host.listMiniAppHosts()).toEqual([])

    const pending = host.executeMiniAppTool('/project', 'demo', 'calculate', {})
    expect(fork).toHaveBeenCalledTimes(2)

    child().emit('message', { type: 'ready' })
    await Promise.resolve()
    const call = child().postMessage.mock.calls.find(([message]) => message.type === 'tool-call')?.[0]
    child().emit('message', { type: 'tool-result', callId: call.callId, result: 7 })
    await expect(pending).resolves.toBe(7)
  })

  it('stays down after an explicit stop', async () => {
    host.startMiniAppHost(START)
    child().spawn()
    host.stopMiniAppHost('/project', 'demo')

    await expect(host.executeMiniAppTool('/project', 'demo', 'calculate', {})).rejects.toThrow(/not running/)
    expect(fork).toHaveBeenCalledTimes(1)
  })

  it('stays down after activation failed, since a reload would fail the same way', async () => {
    host.startMiniAppHost(START)
    child().emit('message', { type: 'activation-error', error: 'boom' })
    child().exit(1)

    await expect(host.executeMiniAppTool('/project', 'demo', 'calculate', {})).rejects.toThrow(/not running/)
    expect(fork).toHaveBeenCalledTimes(1)
  })

  it('kills a host stopped before it finished spawning', () => {
    host.startMiniAppHost(START)
    const process = child()

    host.stopMiniAppHost('/project', 'demo')
    expect(process.postMessage).not.toHaveBeenCalled()

    process.spawn()
    process.emit('spawn')
    expect(process.postMessage).toHaveBeenCalledWith({ type: 'deactivate' })
  })

  it('runs a host action in the renderer and returns its result to the plugin', async () => {
    const runner = vi.fn().mockResolvedValue('clipboard text')
    host.setMiniAppHostActionRunner(runner)
    host.startMiniAppHost(START)

    child().emit('message', {
      type: 'host-action',
      requestId: 'act-1',
      action: 'host.clipboard.read',
      args: {},
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(runner).toHaveBeenCalledWith({
      appId: 'demo', projectDir: '/project', action: 'host.clipboard.read', args: {},
    })
    expect(child().postMessage).toHaveBeenCalledWith({
      type: 'action-response', requestId: 'act-1', result: 'clipboard text',
    })
  })

  it('reports a denied host action back to the plugin as an error', async () => {
    host.setMiniAppHostActionRunner(() => Promise.reject(new Error('Clipboard read denied by user')))
    host.startMiniAppHost(START)

    child().emit('message', { type: 'host-action', requestId: 'act-2', action: 'host.clipboard.read', args: {} })
    await Promise.resolve()
    await Promise.resolve()

    expect(child().postMessage).toHaveBeenCalledWith({
      type: 'action-response', requestId: 'act-2', error: 'Clipboard read denied by user',
    })
  })

  it('pushes locale changes to every live host', async () => {
    host.startMiniAppHost(START)
    child().emit('message', { type: 'ready' })
    await Promise.resolve()

    host.notifyMiniAppHostsLocale('zh')
    await Promise.resolve()

    expect(child().postMessage).toHaveBeenCalledWith({ type: 'locale-changed', locale: 'zh' })
  })

  it('relays context-consumed only to the owning app', async () => {
    host.startMiniAppHost(START)
    child().emit('message', { type: 'ready' })
    await Promise.resolve()

    host.notifyMiniAppContextConsumed('someone-else')
    await Promise.resolve()
    expect(child().postMessage).not.toHaveBeenCalledWith({ type: 'context-consumed' })

    host.notifyMiniAppContextConsumed('demo')
    await Promise.resolve()
    expect(child().postMessage).toHaveBeenCalledWith({ type: 'context-consumed' })
  })

  it('counts only a host that declared background as a background task', () => {
    host.startMiniAppHost(START)
    expect(host.hasActiveMiniAppHosts()).toBe(false)

    // A self-reported status must not promote a UI-bound host to a background task.
    child().emit('message', { type: 'status', text: 'Indexing…' })
    expect(host.hasActiveMiniAppHosts()).toBe(false)

    host.startMiniAppHost({ ...START, appId: 'daemon', background: true })
    expect(host.hasActiveMiniAppHosts()).toBe(true)
  })

  it('releases a UI-bound host with its last panel, keeping it respawnable for tools', async () => {
    host.startMiniAppHost(START)
    child().spawn()

    host.releaseMiniAppHost('/project', 'demo')
    expect(child().postMessage).toHaveBeenCalledWith({ type: 'deactivate' })
    expect(host.listMiniAppHosts()).toEqual([])

    host.executeMiniAppTool('/project', 'demo', 'calculate', {}).catch(() => {})
    expect(fork).toHaveBeenCalledTimes(2)
  })

  it('keeps a host that declared background running after its last panel closes', () => {
    host.startMiniAppHost({ ...START, background: true })
    child().spawn()

    host.releaseMiniAppHost('/project', 'demo')

    expect(child().postMessage).not.toHaveBeenCalledWith({ type: 'deactivate' })
    expect(host.listMiniAppHosts()).toEqual([expect.objectContaining({ appId: 'demo', background: true })])
  })

  it('routes an agent tool call to the host process and resolves its result', async () => {
    host.startMiniAppHost(START)
    const pending = host.executeMiniAppTool('/project', 'demo', 'calculate', { value: 21 })

    expect(child().postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'tool-call' }))
    child().emit('message', { type: 'ready' })
    await Promise.resolve()

    const call = child().postMessage.mock.calls.find(([message]) => message.type === 'tool-call')?.[0]
    expect(call).toMatchObject({ type: 'tool-call', tool: 'calculate', args: { value: 21 } })

    child().emit('message', { type: 'tool-result', callId: call.callId, result: 42 })
    await expect(pending).resolves.toBe(42)
  })

  it('queues WebView messages until activation and forwards them in both directions', async () => {
    const send = vi.fn()
    host.initMiniAppHost(() => ({ isDestroyed: () => false, webContents: { send } }) as never, () => 'en')
    host.startMiniAppHost(START)

    host.postMiniAppWebviewMessage('/project', 'demo', { from: 'view' })
    expect(child().postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'webview-message' }))
    child().emit('message', { type: 'ready' })
    await Promise.resolve()
    expect(child().postMessage).toHaveBeenCalledWith({ type: 'webview-message', payload: { from: 'view' } })

    child().emit('message', { type: 'webview-message', payload: { from: 'host' } })
    expect(send).toHaveBeenCalledWith('miniapp:host-message', {
      appId: 'demo', projectDir: '/project', payload: { from: 'host' },
    })
  })

  it('routes workspace state through host-owned storage', async () => {
    handleMiniAppStateRequest.mockReturnValueOnce({ density: 'compact' })
    host.startMiniAppHost(START)

    child().emit('message', {
      type: 'state-request',
      requestId: 'state-1',
      scope: 'workspace',
      op: 'get',
      key: 'preferences',
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(handleMiniAppStateRequest).toHaveBeenCalledWith(
      'demo',
      expect.objectContaining({
        workspaceStoragePath: START.workspaceStoragePath,
        globalStoragePath: START.globalStoragePath,
      }),
      'workspace',
      'get',
      'preferences',
      undefined,
    )
    expect(child().postMessage).toHaveBeenCalledWith({
      type: 'state-response',
      requestId: 'state-1',
      result: { density: 'compact' },
    })
  })

  it('rejects pending tool calls when the host exits', async () => {
    host.startMiniAppHost(START)
    const pending = host.executeMiniAppTool('/project', 'demo', 'hang', {})

    child().exit(9)
    await expect(pending).rejects.toThrow(/exited with code 9/)
  })

  it('requests graceful deactivation before force-killing the process', () => {
    host.startMiniAppHost(START)
    const process = child()
    process.spawn()

    host.stopMiniAppHost('/project', 'demo')

    expect(process.postMessage).toHaveBeenCalledWith({ type: 'deactivate' })
    expect(closeMiniAppStatePaths).toHaveBeenCalledWith(expect.objectContaining({ appId: 'demo' }))
    expect(process.kill).not.toHaveBeenCalled()
    expect(host.listMiniAppHosts()).toEqual([])
    process.exit(0)
  })
})
