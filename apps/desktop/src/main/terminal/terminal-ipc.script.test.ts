import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentIpcChannels, type TerminalEvent, type TerminalListItem } from '@superone/shared/agent-types'
import { registerTerminalIpc, type TerminalIpcDeps } from './terminal-ipc'
import { TerminalManager } from './terminal-manager'
import { nodePtySpawner } from './pty'
import { terminalLeaseAuthority } from './terminal-lease.test-fixtures'

describe('Bash script terminal IPC', () => {
  it('runs a multiline script in the session workspace and keeps its result tab after exit', async () => {
    const project = mkdtempSync(join(tmpdir(), 'bash project '))
    const workspace = mkdtempSync(join(tmpdir(), 'bash workspace '))
    const zdot = mkdtempSync(join(tmpdir(), 'bash zdot '))
    writeFileSync(join(zdot, '.zprofile'), 'export FENCE_ZPROFILE=from-zprofile\n')
    writeFileSync(join(zdot, '.zshrc'), 'export FENCE_ZSHRC=from-zshrc\n')
    const previousZdot = process.env.ZDOTDIR
    process.env.ZDOTDIR = zdot
    const events: TerminalEvent[] = []
    const manager = new TerminalManager({ spawner: nodePtySpawner, onEvent: e => events.push(e), leaseAuthority: terminalLeaseAuthority() })
    const handlers = new Map<string, (...args: any[]) => any>()
    const resolveCwd = vi.fn((path: string, sessionId?: string) => sessionId ? workspace : path)
    registerTerminalIpc({
      ipc: { handle: (name, handler) => { handlers.set(name, handler) } },
      manager,
      remote: {} as TerminalIpcDeps['remote'],
      resolveCwd,
      ensureShellPath: async () => {},
      ensureControl: async () => {},
    })
    let item: TerminalListItem | undefined
    try {
      item = await handlers.get(AgentIpcChannels.TERMINAL_CREATE)!({}, {
        projectPath: project,
        sessionId: 's1',
        title: 'Bash',
        bashScript: "printf 'stream-first\\n'\nprintf 'profile=%s rc=%s\\n' \"$FENCE_ZPROFILE\" \"$FENCE_ZSHRC\"\nprintf 'err-marker\\n' >&2\npwd\nname='你好'\ncat <<'TEXT'\nliteral $HOME `date`\nTEXT\nprintf '%s\\n' \"$name\"\nsleep 0.6\nprintf 'stream-second\\n'\nexit 7\n",
      })
      expect(resolveCwd).toHaveBeenCalledWith(project, 's1')
      const output = () => events.flatMap(e => e.type === 'terminal_output' ? [e.data] : []).join('')
      await vi.waitFor(() => expect(output()).toContain('stream-first'), { timeout: 4000 })
      expect(output()).not.toContain('stream-second')
      await vi.waitFor(() => expect(output()).toContain('[exit 7]'), { timeout: 4000 })
      expect(output()).toContain('stream-second')
      expect(output()).toContain('err-marker')
      expect(output()).toContain(workspace)
      expect(output()).not.toContain(project)
      expect(output()).toContain('literal $HOME `date`')
      expect(output()).toContain('你好')
      if ((process.env.SHELL ?? '').endsWith('zsh')) {
        expect(output()).toContain('profile=from-zprofile rc=from-zshrc')
      }
      expect(manager.get(item!.terminalId)!.status).toBe('running')
      expect(events.some(e => e.type === 'terminal_exited')).toBe(false)
      manager.get(item!.terminalId)!.input("printf 'tab-still-open\\n'\r")
      await vi.waitFor(() => expect(output()).toContain('tab-still-open'))
    } finally {
      if (previousZdot === undefined) delete process.env.ZDOTDIR
      else process.env.ZDOTDIR = previousZdot
      if (item) manager.kill(item.terminalId)
      rmSync(project, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
      rmSync(zdot, { recursive: true, force: true })
    }
  })
})
