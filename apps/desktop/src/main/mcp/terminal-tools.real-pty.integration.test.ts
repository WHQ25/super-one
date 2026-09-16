/**
 * Drives the terminal tool handlers through a real node-pty + zsh + python3 —
 * the only place `tcgetpgrp`-based control, DECCKM key mapping and resize are
 * exercised for real. Needs a shell that can spawn (not the agent sandbox), so
 * it is opt-in:
 *
 *   SUPERONE_REAL_PTY=1 bunx vitest run src/main/mcp/terminal-tools.real-pty.integration.test.ts
 */
import { describe, expect, it } from 'vitest'
import type { AgentEvent, TerminalListItem } from '@superone/shared/agent-types'
import { nodePtySpawner } from '../terminal/pty'
import { TerminalOwnership } from '../terminal/terminal-ownership'
import { TerminalSession } from '../terminal/terminal-session'
import type { CreateTerminalOptions } from '../terminal/terminal-manager'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'
import { terminalActHandler, terminalSnapshotHandler, terminalTabsHandler, terminalWaitForHandler, type TerminalToolHost } from './terminal-tools'

class RealManager implements TerminalToolHost {
  sessions = new Map<string, TerminalSession>()
  private n = 0
  create(opts: CreateTerminalOptions): TerminalSession {
    const terminalId = `real${++this.n}`
    const s = new TerminalSession({ terminalId, cwd: opts.cwd, projectPath: opts.projectPath, title: opts.title ?? 'T', cols: opts.cols ?? 80, rows: opts.rows ?? 24, spawner: nodePtySpawner, ownership: new TerminalOwnership(), agentSessionId: opts.agentSessionId, onEvent: () => {}, control: { pollMs: 100 } })
    this.sessions.set(terminalId, s)
    return s
  }
  get(id: string) { return this.sessions.get(id) }
  listForProject(): TerminalListItem[] { return [...this.sessions.values()].map((s) => s.listItem()) }
  kill(id: string) { this.sessions.get(id)?.kill(); this.sessions.delete(id) }
}

const parse = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text) as Record<string, unknown>

function deps(manager: RealManager, events: AgentEvent[]): BuiltInSuperoneToolDeps {
  return {
    notifyDevAppReady: () => {}, sessionId: 'agent', applyAppSettings: () => { throw new Error('unused') },
    sessionHost: { getSession: () => ({ projectPath: process.cwd(), cwd: process.cwd(), setTitle: () => {}, emitHostEvent: (e: AgentEvent) => events.push(e) }) },
    terminals: { manager, rules: { isPreapproved: () => true, add: () => {} } },
  }
}

describe.skipIf(!process.env.SUPERONE_REAL_PTY)('terminal tools against a real PTY', () => {
  it('act: type / key / raw / resize / wait + expect; snapshot sections; attach; close', async () => {
    const manager = new RealManager(); const events: AgentEvent[] = []; const d = deps(manager, events)
    const run = parse(await terminalTabsHandler({ action: 'run', command: 'python3 -i', size: { cols: 100, rows: 30 } }, d))
    expect(run.status).toBe('ok'); expect(run.foreground).toMatch(/python/i)
    const tab = run.tab as string

    // type (Enter default) + expect text
    const t1 = parse(await terminalActHandler({ tab, actions: [{ type: 'type', text: 'print(6*7)' }], expect: { text: '42' }, timeoutMs: 5000 }, d))
    expect(t1.status).toBe('ok'); expect(t1.expectMet).toBe(true)

    // type without enter, then key Enter, then wait inside a batch
    const t2 = parse(await terminalActHandler({ tab, actions: [{ type: 'type', text: 'x = "par', enter: false }, { type: 'type', text: 'tial"' }, { type: 'wait', ms: 100 }, { type: 'type', text: 'print(x)' }], expect: { text: 'partial' }, timeoutMs: 5000 }, d))
    expect(t2.status).toBe('ok'); expect(t2.stepsExecuted).toBe(4); expect(t2.expectMet).toBe(true)

    // raw bytes: send "print(1+1)" + CR as raw
    const t3 = parse(await terminalActHandler({ tab, actions: [{ type: 'raw', bytes: 'print(1+1)\r' }], expect: { text: '2\n' }, timeoutMs: 5000 }, d))
    expect(t3.status).toBe('ok')

    // resize is reflected by the session and by python's shutil
    const t4 = parse(await terminalActHandler({ tab, actions: [{ type: 'resize', cols: 60, rows: 20 }, { type: 'wait', ms: 200 }, { type: 'type', text: 'import shutil; print(shutil.get_terminal_size())' }], expect: { text: 'columns=60' }, timeoutMs: 5000 }, d))
    expect(t4.status).toBe('ok'); expect(t4.expectMet).toBe(true)
    expect(manager.get(tab)!.cols).toBe(60)

    // key: Up recalls history, Ctrl+U clears the line
    const t5 = parse(await terminalActHandler({ tab, actions: [{ type: 'key', key: 'Up' }, { type: 'key', key: 'Ctrl+U' }, { type: 'type', text: 'print("after-up")' }], expect: { text: 'after-up' }, timeoutMs: 5000 }, d))
    expect(t5.status).toBe('ok')

    // snapshot sections
    const snap = parse(await terminalSnapshotHandler({ tab, include: ['screen', 'scrollback', 'cursor', 'meta'], tail: 500 }, d))
    expect((snap.screen as string[]).some((l) => l.includes('after-up'))).toBe(true)
    expect(String(snap.scrollback)).toContain('42')
    expect(snap.cursor).toMatchObject({ row: expect.any(Number), col: expect.any(Number) })
    expect(snap.meta).toMatchObject({ foreground: expect.stringMatching(/python/i), control: 'me', cols: 60, rows: 20, openedBy: 'agent' })

    // wait_for exited: quit python → control released
    const t6 = parse(await terminalActHandler({ tab, actions: [{ type: 'type', text: 'exit()' }], expect: { exited: true }, timeoutMs: 5000 }, d))
    expect(t6.expectMet).toBe(true); expect(t6.control).toBe('none')
    const w = parse(await terminalWaitForHandler({ tab, idleMs: 200, timeoutMs: 3000 }, d))
    expect(w.met).toBe(true)

    // attach to a "user" tab running a command
    const user = manager.create({ cwd: process.cwd(), projectPath: process.cwd(), title: 'user' })
    const { waitForTerminal } = await import('../terminal/terminal-wait')
    await waitForTerminal(user, { idleMs: 700 }, { timeoutMs: 8000 })
    user.input('sleep 30\r')
    for (let i = 0; i < 50 && user.isAtShell(); i++) await new Promise((r) => setTimeout(r, 100))
    expect(user.foregroundProcess()).toBe('sleep')
    const denied = await terminalSnapshotHandler({ tab: user.terminalId }, d)
    expect(denied.isError).toBe(true)
    const att = parse(await terminalTabsHandler({ action: 'attach', tab: user.terminalId }, d))
    expect(att.status).toBe('ok'); expect(att.command).toBe('sleep')
    const ctrlc = parse(await terminalActHandler({ tab: user.terminalId, actions: [{ type: 'key', key: 'Ctrl+C' }], expect: { exited: true }, timeoutMs: 5000 }, d))
    expect(ctrlc.expectMet).toBe(true)

    // list + close (agent tab: no confirm; user tab: confirm → decline)
    const list = await terminalTabsHandler({}, d)
    expect(list.content[0].text).toContain('count: 2')
    setTimeout(async () => { const { resolveTerminalCommandConfirm } = await import('./terminal-command-confirm'); const req = events.filter((e) => e.type === 'permission_request').at(-1) as { request: { requestId: string } }; resolveTerminalCommandConfirm(req.request.requestId, 'decline', false, 'keep it') }, 300)
    const closed = parse(await terminalTabsHandler({ action: 'close', tab: [tab, user.terminalId] }, d))
    expect(closed.closed).toEqual([tab]); expect(closed.skipped).toEqual([{ tab: user.terminalId, reason: 'keep it' }])
    manager.kill(user.terminalId)
  }, 60_000)
})
