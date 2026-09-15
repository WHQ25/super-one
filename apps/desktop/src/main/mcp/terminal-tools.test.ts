import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, PermissionRequest, TerminalListItem } from '@superone/shared/agent-types'
import type { PtyLike, PtySpawner } from '../terminal/pty'
import { TerminalOwnership } from '../terminal/terminal-ownership'
import { TerminalSession } from '../terminal/terminal-session'
import type { CreateTerminalOptions } from '../terminal/terminal-manager'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'
import {
  clearTerminalCommandConfirmsForTests,
  resolveTerminalCommandConfirm,
} from './terminal-command-confirm'
import {
  terminalActHandler,
  terminalSnapshotHandler,
  terminalTabsHandler,
  terminalWaitForHandler,
  type TerminalToolHost,
} from './terminal-tools'

/**
 * A PTY whose "shell" launches whatever line is typed: the first word becomes the
 * foreground process until the test sends it back to the prompt.
 */
function fakePty() {
  let dataCb: (d: string) => void = () => {}
  const pty: PtyLike & { foreground: string; writes: string[]; emitData: (d: string) => void } = {
    foreground: 'zsh',
    writes: [],
    write: (d) => {
      pty.writes.push(d)
      // A real tty echoes typed input, which is what resets idle detection.
      dataCb(d.replace(/\r$/, '\r\n'))
      if (d.endsWith('\r') && pty.foreground === 'zsh') {
        const word = d.trim().split(' ')[0]
        if (word) pty.foreground = word
      }
    },
    resize: () => {},
    onData: (cb) => { dataCb = cb },
    onExit: () => {},
    kill: () => {},
    foregroundProcess: () => pty.foreground,
    emitData: (d) => dataCb(d),
  }
  return pty
}

class StubManager implements TerminalToolHost {
  sessions = new Map<string, TerminalSession>()
  ptys = new Map<string, ReturnType<typeof fakePty>>()
  killed: string[] = []
  private n = 0

  create(opts: CreateTerminalOptions): TerminalSession {
    const pty = fakePty()
    const spawner: PtySpawner = { spawn: () => pty }
    const terminalId = `t${++this.n}`
    const session = new TerminalSession({
      terminalId,
      cwd: opts.cwd,
      projectPath: opts.projectPath,
      title: opts.title ?? 'Terminal',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      spawner,
      ownership: new TerminalOwnership(),
      shell: '/bin/zsh',
      openedByAgent: opts.openedByAgent,
      onEvent: () => {},
      control: { pollMs: 20, startGraceMs: 200, idleMs: 50 },
    })
    this.sessions.set(terminalId, session)
    this.ptys.set(terminalId, pty)
    // A login shell draws its prompt right after spawn; run waits for it.
    pty.emitData('$ ')
    return session
  }

  get(terminalId: string): TerminalSession | undefined {
    return this.sessions.get(terminalId)
  }

  listForProject(): TerminalListItem[] {
    return [...this.sessions.values()].map((s) => s.listItem())
  }

  kill(terminalId: string): void {
    this.killed.push(terminalId)
    this.sessions.get(terminalId)?.kill()
    this.sessions.delete(terminalId)
  }
}

function makeDeps(opts: { preapproved?: string[]; signal?: AbortSignal } = {}) {
  const manager = new StubManager()
  const events: AgentEvent[] = []
  const rulesAdded: string[] = []
  const deps: BuiltInSuperoneToolDeps = {
    notifyDevAppReady: () => {},
    sessionId: 'agent-1',
    sessionHost: {
      getSession: () => ({
        projectPath: '/proj',
        cwd: '/proj',
        setTitle: () => {},
        emitHostEvent: (event: AgentEvent) => events.push(event),
      }),
    },
    applyAppSettings: () => { throw new Error('unused') },
    terminals: {
      manager,
      rules: {
        isPreapproved: (_project, command) => (opts.preapproved ?? []).some((rule) => command.startsWith(rule)),
        add: (_project, pattern) => rulesAdded.push(pattern),
      },
    },
    signal: opts.signal,
  }
  return { deps, manager, events, rulesAdded }
}

function pendingRequest(events: AgentEvent[]): PermissionRequest | undefined {
  const evt = [...events].reverse().find((e) => e.type === 'permission_request')
  return evt && evt.type === 'permission_request' ? evt.request : undefined
}

const parse = (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0].text) as Record<string, unknown>

/** Answer the next confirm as soon as it is raised. */
function answerNextConfirm(events: AgentEvent[], allow: boolean, alwaysAllow = false, reason?: string) {
  const timer = setInterval(() => {
    const req = pendingRequest(events)
    if (!req) return
    clearInterval(timer)
    resolveTerminalCommandConfirm(req.requestId, allow ? 'accept' : 'decline', alwaysAllow, reason)
  }, 5)
}

afterEach(() => {
  clearTerminalCommandConfirmsForTests()
  vi.restoreAllMocks()
})

describe('terminal_tabs run', () => {
  it('asks the user per command and runs nothing on decline', async () => {
    const { deps, manager, events } = makeDeps()
    answerNextConfirm(events, false, false, 'not now')
    const result = parse(await terminalTabsHandler({ action: 'run', command: 'bun run dev' }, deps))
    expect(result.status).toBe('rejected')
    expect(result.reason).toBe('not now')
    expect(manager.sessions.size).toBe(0)
    const req = pendingRequest(events)
    expect(req?.requestKind).toBe('terminal_command_confirm')
    expect(req?.input).toMatchObject({ action: 'run', command: 'bun run dev', cwd: '/proj', rule: 'bun run dev:*' })
    expect(req?.allowAlwaysAllow).toBe(true)
    expect(events.some((e) => e.type === 'interaction_resolved')).toBe(true)
  })

  it('opens an agent tab, types the approved command and holds control while it runs', async () => {
    const { deps, manager, events, rulesAdded } = makeDeps()
    answerNextConfirm(events, true, true)
    const result = parse(await terminalTabsHandler({ action: 'run', command: 'bun run storybook --ci' }, deps))
    expect(result.status).toBe('ok')
    expect(result.tab).toBe('t1')
    expect(result.control).toBe('me')
    expect(result.foreground).toBe('bun')
    expect(rulesAdded).toEqual(['bun run storybook --ci:*'])
    const session = manager.get('t1')!
    expect(session.openedByAgent).toBe(true)
    expect(manager.ptys.get('t1')!.writes).toEqual(['bun run storybook --ci\r'])
    expect(session.agentControl?.command).toBe('bun run storybook --ci')
  })

  it('hints to close the tab when the command exits during the yield', async () => {
    const { deps, manager } = makeDeps({ preapproved: ['npm run dev'] })
    const pending = terminalTabsHandler({ action: 'run', command: 'npm run dev', yieldMs: 3000 }, deps)
    while (!manager.ptys.get('t1')?.writes.length) await new Promise((r) => setTimeout(r, 10))
    const pty = manager.ptys.get('t1')!
    pty.emitData('Error: listen EADDRINUSE 0.0.0.0:8765\r\n')
    pty.foreground = 'zsh'
    pty.emitData('$ ')
    const result = parse(await pending)
    expect(result.status).toBe('ok')
    expect(result.control).toBe('none')
    expect(result.hint).toMatch(/already exited/)
  })

  it('names unknown parameters instead of silently dropping them', async () => {
    const { deps } = makeDeps()
    const wait = await terminalWaitForHandler({ tab: 't1', timeout: 5000 } as never, deps)
    expect(wait.isError).toBe(true)
    expect(wait.content[0].text).toContain('Unknown parameter "timeout" for terminal_wait_for — did you mean "timeoutMs"?')
    const act = await terminalActHandler({ tab: 't1', actions: [{ action: 'key', key: 'Enter' }] } as never, deps)
    expect(act.isError).toBe(true)
    expect(act.content[0].text).toContain('Unknown parameter "action" in actions[0]')
    expect(act.content[0].text).toContain('Accepted: type, text, enter, key, repeat, bytes, cols, rows, ms.')
  })

  it('skips the prompt for a preapproved command', async () => {
    const { deps, events } = makeDeps({ preapproved: ['python3'] })
    const result = parse(await terminalTabsHandler({ action: 'run', command: 'python3 -i' }, deps))
    expect(result.status).toBe('ok')
    expect(events.some((e) => e.type === 'permission_request')).toBe(false)
  })

  it('returns cancelled without effect when the turn aborts during the prompt', async () => {
    const controller = new AbortController()
    const { deps, manager } = makeDeps({ signal: controller.signal })
    setTimeout(() => controller.abort(), 20)
    const result = parse(await terminalTabsHandler({ action: 'run', command: 'vim' }, deps))
    expect(result.status).toBe('cancelled')
    expect(manager.sessions.size).toBe(0)
  })

  it('refuses to reuse a tab that is busy', async () => {
    const { deps, manager } = makeDeps({ preapproved: ['sleep', 'ls'] })
    await terminalTabsHandler({ action: 'run', command: 'sleep 100' }, deps)
    expect(manager.get('t1')!.foregroundProcess()).toBe('sleep')
    const result = await terminalTabsHandler({ action: 'run', command: 'ls', tab: 't1' }, deps)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/busy running sleep/)
  })
})

describe('terminal_act', () => {
  it('sends input while the command runs and is rejected once it exits', async () => {
    const { deps, manager } = makeDeps({ preapproved: ['python3'] })
    await terminalTabsHandler({ action: 'run', command: 'python3' }, deps)
    const pty = manager.ptys.get('t1')!

    const ok = parse(await terminalActHandler({ tab: 't1', actions: [{ type: 'type', text: 'print(1)' }, { type: 'key', key: 'Ctrl+D' }] }, deps))
    expect(ok.status).toBe('ok')
    expect(ok.stepsExecuted).toBe(2)
    expect(pty.writes.slice(1)).toEqual(['print(1)\r', '\x04'])

    pty.foreground = 'zsh'
    await new Promise((r) => setTimeout(r, 60))
    const rejected = parse(await terminalActHandler({ tab: 't1', actions: [{ type: 'type', text: 'rm -rf /' }] }, deps))
    expect(rejected.status).toBe('rejected')
    expect(rejected.reason).toBe('command_exited')
    expect(pty.writes).toHaveLength(3)
  })

  it('stops at an unknown key and reports the steps that ran', async () => {
    const { deps, manager } = makeDeps({ preapproved: ['vim'] })
    await terminalTabsHandler({ action: 'run', command: 'vim' }, deps)
    const result = await terminalActHandler({ tab: 't1', actions: [{ type: 'key', key: 'Escape' }, { type: 'key', key: 'Hyper+Q' }] }, deps)
    expect(result.isError).toBe(true)
    expect(parse(result).stepsExecuted).toBe(1)
    expect(manager.ptys.get('t1')!.writes.at(-1)).toBe('\x1b')
  })

  it('rejects after the user takes over', async () => {
    const { deps, manager } = makeDeps({ preapproved: ['htop'] })
    await terminalTabsHandler({ action: 'run', command: 'htop' }, deps)
    manager.get('t1')!.takeOver()
    const result = parse(await terminalActHandler({ tab: 't1', actions: [{ type: 'key', key: 'q' }] }, deps))
    expect(result.status).toBe('rejected')
    expect(result.reason).toBe('user_took_over')
  })
})

describe('terminal_snapshot / wait_for / attach', () => {
  it('reads agent tabs but not user tabs until attached', async () => {
    const { deps, manager, events } = makeDeps({ preapproved: ['node'] })
    const userTab = manager.create({ cwd: '/proj', projectPath: '/proj', title: 'user' })
    const userPty = manager.ptys.get(userTab.terminalId)!
    const denied = await terminalSnapshotHandler({ tab: userTab.terminalId }, deps)
    expect(denied.isError).toBe(true)
    expect(denied.content[0].text).toMatch(/attach/)

    // Nothing running → attach has no command to approve.
    const idle = await terminalTabsHandler({ action: 'attach', tab: userTab.terminalId }, deps)
    expect(idle.isError).toBe(true)

    userPty.write('node\r')
    userPty.emitData('server listening on 3000\r\n')
    const attached = parse(await terminalTabsHandler({ action: 'attach', tab: userTab.terminalId }, deps))
    expect(attached.status).toBe('ok')
    expect(events.some((e) => e.type === 'permission_request')).toBe(false)
    expect(attached.control).toBe('me')

    const snap = parse(await terminalSnapshotHandler({ tab: userTab.terminalId, include: ['screen', 'meta', 'scrollback'] }, deps))
    expect(snap.screen).toEqual(['$ node', 'server listening on 3000'])
    expect((snap.meta as { command: string }).command).toBe('node')
    expect(snap.scrollback).toBe('$ node\nserver listening on 3000')
  })

  it('waits for text and reports the screen', async () => {
    const { deps, manager } = makeDeps({ preapproved: ['bun'] })
    await terminalTabsHandler({ action: 'run', command: 'bun run dev' }, deps)
    setTimeout(() => manager.ptys.get('t1')!.emitData('Local:   http://localhost:6006\r\n'), 30)
    const result = parse(await terminalWaitForHandler({ tab: 't1', text: 'localhost:6006', timeoutMs: 2000 }, deps))
    expect(result.status).toBe('ok')
    expect(result.met).toBe(true)
    expect((result.screen as string[]).join('\n')).toContain('localhost:6006')
    const missing = await terminalWaitForHandler({ tab: 't1' }, deps)
    expect(missing.isError).toBe(true)
  })
})

describe('terminal_tabs close', () => {
  it('closes agent tabs freely and confirms user tabs without always-allow', async () => {
    const { deps, manager, events } = makeDeps({ preapproved: ['vim'] })
    await terminalTabsHandler({ action: 'run', command: 'vim' }, deps)
    const userTab = manager.create({ cwd: '/proj', projectPath: '/proj', title: 'user' })
    answerNextConfirm(events, false)
    const result = parse(await terminalTabsHandler({ action: 'close', tab: ['t1', userTab.terminalId] }, deps))
    expect(result.closed).toEqual(['t1'])
    expect(result.skipped).toEqual([{ tab: userTab.terminalId, reason: 'User declined' }])
    expect(manager.killed).toEqual(['t1'])
    expect(pendingRequest(events)?.allowAlwaysAllow).toBe(false)
  })
})
