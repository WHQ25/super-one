import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentIpcChannels, type TerminalEvent, type TerminalListItem } from '@superone/shared/agent-types'
import { registerTerminalIpc, type TerminalIpcDeps } from './terminal-ipc'
import { TerminalManager } from './terminal-manager'
import { nodePtySpawner } from './pty'
import { terminalLeaseAuthority } from './terminal-lease.test-fixtures'

describe('Bash script terminal IPC', () => {
  it('runs a multiline script at the project root and keeps its result tab after exit', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bash project '))
    const events: TerminalEvent[] = []
    const manager = new TerminalManager({ spawner: nodePtySpawner, onEvent: e => events.push(e), leaseAuthority: terminalLeaseAuthority() })
    const handlers = new Map<string, (...args: any[]) => any>()
    const resolveCwd = vi.fn((project: string) => project)
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
        projectPath: cwd,
        title: 'Bash',
        bashScript: "pwd\nname='你好'\ncat <<'TEXT'\nliteral $HOME `date`\nTEXT\nprintf '%s\\n' \"$name\"\nexit 7\n",
      })
      expect(resolveCwd).toHaveBeenCalledWith(cwd, undefined)
      const output = () => events.flatMap(e => e.type === 'terminal_output' ? [e.data] : []).join('')
      await vi.waitFor(() => expect(output()).toContain('[exit 7]'))
      expect(output()).toContain(cwd)
      expect(output()).toContain('literal $HOME `date`')
      expect(output()).toContain('你好')
      expect(manager.get(item!.terminalId)!.status).toBe('running')
      expect(events.some(e => e.type === 'terminal_exited')).toBe(false)
      manager.get(item!.terminalId)!.input("printf 'tab-still-open\\n'\r")
      await vi.waitFor(() => expect(output()).toContain('tab-still-open'))
    } finally {
      if (item) manager.kill(item.terminalId)
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
