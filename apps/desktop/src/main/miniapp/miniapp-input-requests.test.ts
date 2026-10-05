import { EventEmitter } from 'events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'

const { children } = vi.hoisted(() => ({ children: [] as FakeUtilityProcess[] }))

class FakeUtilityProcess extends EventEmitter {
  pid: number | undefined = 42
  postMessage = vi.fn()
  kill = vi.fn(() => { this.emit('exit', 0); return true })
  stdout = new EventEmitter()
  stderr = new EventEmitter()
}

vi.mock('electron', () => ({
  app: { getVersion: () => '9.9.9' },
  utilityProcess: { fork: () => { const child = new FakeUtilityProcess(); children.push(child); return child } },
}))
vi.mock('fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('fs')>()), mkdirSync: vi.fn() }))
vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./miniapp-state', () => ({ closeMiniAppStatePaths: vi.fn(), handleMiniAppStateRequest: vi.fn() }))

const host = await import('./miniapp-host')
const { openMiniAppInputRequest } = await import('./miniapp-input-requests')
const { claimInputRequestForSend, clearInputRequestsForTests, isInputRequestId, respondToInputRequest } = await import('../session/input-requests')

const spec = { title: 'Pick a color', requestedSchema: { type: 'object', properties: { color: { type: 'string' } }, required: ['color'] } }

function local(id: string, projectPath = '/project') {
  const events: AgentEvent[] = []
  return { id, projectPath, events, emitHostEvent: (event: AgentEvent) => { events.push(event) } }
}

function deps(sessions: ReturnType<typeof local>[], authorized: string[]) {
  return {
    getSession: (id: string) => sessions.find(session => session.id === id) ?? null,
    sessionsAuthorizingApp: () => authorized,
  }
}

const request = { appId: 'demo', appName: 'Demo', projectDir: '/project', spec, output: 'caller' as const }

afterEach(() => {
  host.stopAllMiniAppHosts()
  children.length = 0
  clearInputRequestsForTests()
})

describe('openMiniAppInputRequest', () => {
  it('uses the only authorized session when none is named and attributes the form to the app', () => {
    const s1 = local('s1')
    openMiniAppInputRequest(deps([s1], ['s1']), request)
    expect(s1.events[0]).toMatchObject({
      type: 'permission_request',
      request: { toolName: 'superone_input_request', inputRequest: { origin: { kind: 'miniapp', appId: 'demo', appName: 'Demo' }, output: 'caller' } },
    })
  })

  it('never guesses between sessions and refuses sessions the app does not hold', () => {
    const sessions = [local('s1'), local('s2'), local('other', '/elsewhere')]
    expect(() => openMiniAppInputRequest(deps(sessions, ['s1', 's2']), request)).toThrow(/several sessions/)
    expect(() => openMiniAppInputRequest(deps(sessions, []), request)).toThrow(/no session/)
    expect(() => openMiniAppInputRequest(deps(sessions, ['s1']), { ...request, sessionId: 's2' })).toThrow(/not authorized/)
    expect(() => openMiniAppInputRequest(deps(sessions, ['other']), { ...request, sessionId: 'other' })).toThrow(/not authorized/)
    expect(() => openMiniAppInputRequest(deps(sessions, ['node-uuid']), { ...request, sessionId: 'node-uuid' })).toThrow(/local desktop sessions/)
    expect(sessions.every(session => session.events.length === 0)).toBe(true)
  })

  it('rejects invalid forms and caps live forms per session', () => {
    const s1 = local('s1')
    const d = deps([s1], ['s1'])
    expect(() => openMiniAppInputRequest(d, { ...request, spec: { title: 'x' } })).toThrow(/requestedSchema/)
    for (let i = 0; i < 4; i++) openMiniAppInputRequest(d, request)
    expect(() => openMiniAppInputRequest(d, request)).toThrow(/at most 4/)
  })
})

describe('MiniApp Host composer messages', () => {
  const START = {
    appId: 'demo', projectDir: '/project', name: 'Demo', appPath: '/apps/demo', entryPath: '/apps/demo/node.js',
    background: false, workspaceStoragePath: '/w', globalStoragePath: '/g',
  }

  function started(sessions = [local('s1')]) {
    host.initMiniAppHost(() => null, () => 'en')
    host.setMiniAppInputRequestOpener(input => openMiniAppInputRequest(deps(sessions, ['s1']), input))
    host.startMiniAppHost(START)
    return { child: children.at(-1)!, session: sessions[0]! }
  }

  function promptId(session: ReturnType<typeof local>): string {
    const event = session.events.find(candidate => candidate.type === 'permission_request')
    if (event?.type !== 'permission_request') throw new Error('no prompt')
    return event.request.requestId
  }

  it('returns the answer to the app and nothing else', async () => {
    const { child, session } = started()
    child.emit('message', { type: 'input-request-open', localId: 'l1', spec, sessionId: 's1' })
    expect(respondToInputRequest('s1', promptId(session), { allow: true, formAnswers: { color: 'red' } })).toBe(true)
    await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledWith({
      type: 'input-request-settled', localId: 'l1', outcome: { status: 'submitted', values: { color: 'red' } },
    }))
  })

  it('reports an invalid form as an error and cancels on request or when the host stops', async () => {
    const { child, session } = started()
    child.emit('message', { type: 'input-request-open', localId: 'bad', spec: { title: 'x' } })
    expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'input-request-settled', localId: 'bad', error: expect.stringMatching(/requestedSchema/) }))

    child.emit('message', { type: 'input-request-open', localId: 'l1', spec })
    child.emit('message', { type: 'input-request-cancel', localId: 'l1' })
    await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledWith({
      type: 'input-request-settled', localId: 'l1', outcome: { status: 'cancelled', reason: 'aborted' },
    }))

    child.emit('message', { type: 'input-request-open', localId: 'l2', spec })
    const id = promptId({ ...session, events: session.events.slice(2) })
    host.stopMiniAppHost('/project', 'demo')
    await vi.waitFor(() => expect(session.events.at(-1)).toMatchObject({ type: 'interaction_resolved', requestId: id }))
  })

  it('sends an agent-output answer to the agent and tells the app only that it was submitted', async () => {
    const { child, session } = started()
    child.emit('message', { type: 'input-request-open', localId: 'l1', spec, output: 'agent' })
    expect(session.events[0]).toMatchObject({ request: { inputRequest: { origin: { kind: 'miniapp', appName: 'Demo' }, output: 'agent' } } })
    const sent = claimInputRequestForSend('s1', { content: '', clientMessageId: 'c1', inputRequest: { requestId: promptId(session), values: { color: 'red' } } })
    expect(sent.content).toBe('Pick a color\ncolor: red')
    await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledWith({ type: 'input-request-settled', localId: 'l1', outcome: { status: 'submitted' } }))
    child.emit('message', { type: 'input-request-open', localId: 'bad', spec, output: 'both' })
    expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({ localId: 'bad', error: expect.stringMatching(/"output"/) }))
  })

  it('stopping the Host keeps the forms its WebViews opened, which share its quota', () => {
    const { child, session } = started()
    const view = openMiniAppInputRequest(deps([session], ['s1']), request)
    for (let i = 0; i < 3; i++) child.emit('message', { type: 'input-request-open', localId: `l${i}`, spec })
    child.emit('message', { type: 'input-request-open', localId: 'over', spec })
    expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({ localId: 'over', error: expect.stringMatching(/at most 4/) }))
    host.stopMiniAppHost('/project', 'demo')
    expect(isInputRequestId(view.requestId)).toBe(true)
  })

  it('hands the tool handler its session and aborts the call on timeout', async () => {
    vi.useFakeTimers()
    try {
      const { child } = started()
      child.emit('message', { type: 'ready' })
      const call = host.executeMiniAppTool('/project', 'demo', 'slow', {}, 's1')
      await vi.advanceTimersByTimeAsync(0)
      const sent = child.postMessage.mock.calls.find(([message]) => message.type === 'tool-call')?.[0]
      expect(sent).toMatchObject({ tool: 'slow', session: { sessionId: 's1' } })
      const settled = expect(call).rejects.toThrow(/timed out/)
      await vi.advanceTimersByTimeAsync(120_000)
      await settled
      expect(child.postMessage).toHaveBeenCalledWith({ type: 'tool-abort', callId: sent.callId })
    } finally {
      vi.useRealTimers()
    }
  })
})
