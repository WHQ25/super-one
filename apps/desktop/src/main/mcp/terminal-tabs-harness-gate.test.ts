import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, PermissionRequest } from '@superone/shared/agent-types'
import type { TerminalCommandRuleScope } from '@superone/shared/terminal-command-rules'
import type { TerminalSession } from '../terminal/terminal-session'

const mocks = vi.hoisted(() => ({
  getSessionHost: vi.fn(),
  getTerminalToolDeps: vi.fn(),
}))
vi.mock('./superone-mcp-server', () => ({
  getSessionHost: mocks.getSessionHost,
  getTerminalToolDeps: mocks.getTerminalToolDeps,
}))

import { clearTerminalCommandConfirmsForTests, resolveTerminalCommandConfirm } from './terminal-command-confirm'
import { gateTerminalTabsCall, isTerminalTabsTool } from './terminal-tabs-harness-gate'

/** Just enough of a running user tab for `attach` to name its foreground command. */
function runningTab(id: string, foreground: string): TerminalSession {
  return {
    terminalId: id,
    title: 'user',
    cwd: '/proj',
    status: 'running',
    agentSessionId: undefined,
    isAtShell: () => false,
    foregroundProcess: () => foreground,
    listItem: () => ({ terminalId: id, agentSessionId: undefined }),
  } as unknown as TerminalSession
}

function install(opts: { projectPath?: string; preapproved?: boolean; tabs?: TerminalSession[] } = {}) {
  const events: AgentEvent[] = []
  const remembered: Array<{ scope: TerminalCommandRuleScope; pattern: string; sessionId: string; projectKey: string }> = []
  const tabs = new Map((opts.tabs ?? []).map((t) => [t.terminalId, t]))
  mocks.getSessionHost.mockReturnValue({
    getSession: () => ({
      projectPath: opts.projectPath ?? '/proj',
      cwd: '/proj',
      setTitle: () => {},
      emitHostEvent: (event: AgentEvent) => events.push(event),
    }),
  })
  mocks.getTerminalToolDeps.mockReturnValue({
    manager: {
      create: () => { throw new Error('unused') },
      get: (id: string) => tabs.get(id),
      listForProject: () => [...tabs.values()].map((t) => t.listItem()),
      kill: () => {},
    },
    rules: {
      isPreapproved: () => opts.preapproved ?? false,
      remember: (scope: TerminalCommandRuleScope, projectKey: string, sessionId: string, pattern: string) =>
        remembered.push({ scope, projectKey, sessionId, pattern }),
    },
  })
  return { events, remembered }
}

function lastRequest(events: AgentEvent[]): PermissionRequest | undefined {
  const evt = [...events].reverse().find((e) => e.type === 'permission_request')
  return evt?.type === 'permission_request' ? evt.request : undefined
}

function answerNext(events: AgentEvent[], allow: boolean, remember: TerminalCommandRuleScope | false = false, reason?: string) {
  const timer = setInterval(() => {
    const req = lastRequest(events)
    if (!req) return
    clearInterval(timer)
    resolveTerminalCommandConfirm(req.requestId, allow ? 'accept' : 'decline', remember === 'project', reason, remember ? { scope: remember } : undefined)
  }, 5)
}

afterEach(() => {
  clearTerminalCommandConfirmsForTests()
  vi.resetAllMocks()
})

describe('gateTerminalTabsCall', () => {
  it('recognizes only the qualified terminal_tabs name', () => {
    expect(isTerminalTabsTool('mcp__superone__terminal_tabs')).toBe(true)
    expect(isTerminalTabsTool('mcp__superone__terminal_act')).toBe(false)
    expect(isTerminalTabsTool('terminal_tabs')).toBe(false)
  })

  it('raises the terminal prompt for a run and remembers the rule with the chosen lifetime', async () => {
    const { events, remembered } = install()
    answerNext(events, true, 'session')
    const auth = await gateTerminalTabsCall('sess-1', { action: 'run', command: 'PORT=1 bun run dev', description: 'dev server' }, {
      defaultToNo: true,
      decisionReason: 'classifier flagged it',
    })
    expect(auth).toEqual({ status: 'allowed' })
    const req = lastRequest(events)
    expect(req).toMatchObject({
      requestKind: 'terminal_command_confirm',
      defaultToNo: true,
      decisionReason: 'classifier flagged it',
      input: { action: 'run', command: 'PORT=1 bun run dev', cwd: '/proj', rule: '(\\w+=\\S+ )*bun run( .*)?', description: 'dev server' },
    })
    expect(remembered).toEqual([{ scope: 'session', projectKey: '/proj', sessionId: 'sess-1', pattern: '(\\w+=\\S+ )*bun run( .*)?' }])
  })

  it('answers from the rules without a prompt, and reports a decline with its reason', async () => {
    const pre = install({ preapproved: true })
    expect(await gateTerminalTabsCall('sess-1', { action: 'run', command: 'bun run dev' })).toEqual({ status: 'allowed' })
    expect(pre.events).toHaveLength(0)

    const { events } = install()
    answerNext(events, false, false, 'not now')
    expect(await gateTerminalTabsCall('sess-1', { action: 'run', command: 'rm -rf build' })).toEqual({ status: 'rejected', reason: 'not now' })
  })

  it('approves the foreground command of the tab an attach targets', async () => {
    const { events } = install({ tabs: [runningTab('t9', 'node')] })
    answerNext(events, true)
    expect(await gateTerminalTabsCall('sess-1', { action: 'attach', tab: 't9' })).toEqual({ status: 'allowed' })
    expect(lastRequest(events)?.input).toMatchObject({ action: 'attach', command: 'node', tab: 'user' })
  })

  it('lets through what the executor will answer itself: list, close, unknown tab, remote project', async () => {
    const { events } = install()
    expect(await gateTerminalTabsCall('sess-1', { action: 'list' })).toEqual({ status: 'allowed' })
    expect(await gateTerminalTabsCall('sess-1', { action: 'close', tab: 't1' })).toEqual({ status: 'allowed' })
    expect(await gateTerminalTabsCall('sess-1', { action: 'attach', tab: 'missing' })).toEqual({ status: 'allowed' })
    expect(events).toHaveLength(0)

    const remote = install({ projectPath: 'remote:node-1:/srv/app' })
    expect(await gateTerminalTabsCall('sess-1', { action: 'run', command: 'bun run dev' })).toEqual({ status: 'allowed' })
    expect(remote.events).toHaveLength(0)
  })

  it('returns cancelled when the turn aborts while the prompt is open', async () => {
    install()
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 10)
    const auth = await gateTerminalTabsCall('sess-1', { action: 'run', command: 'vim' }, { signal: controller.signal })
    expect(auth.status).toBe('cancelled')
  })
})
