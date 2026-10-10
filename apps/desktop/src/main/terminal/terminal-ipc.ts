import type { IpcMain } from 'electron'
import { basename } from 'node:path'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import type { TerminalManager } from './terminal-manager'
import type { RemoteTerminalController } from '../environment/remote-terminal-controller'

export interface TerminalIpcDeps {
  ipc: Pick<IpcMain, 'handle'>
  manager: TerminalManager
  remote: RemoteTerminalController
  resolveCwd(projectPath: string, sessionId?: string): string
  ensureShellPath(): Promise<void>
  ensureControl(): Promise<void>
}

/** The IPC sender is the local control actor; all mutations pass through the domain's fenced leases. */
export function registerTerminalIpc(deps: TerminalIpcDeps): void {
  deps.ipc.handle(
    AgentIpcChannels.TERMINAL_CREATE,
    async (_e, opts: { projectPath: string; sessionId?: string; title?: string; cols?: number; rows?: number; openedInActivity?: boolean }) => {
      if (parseRemoteProjectKey(opts.projectPath)) {
        return deps.remote.create(opts)
      }
      await deps.ensureControl()
      const cwd = deps.resolveCwd(opts.projectPath, opts.sessionId)
      // The pty inherits process.env and its shell is not a login shell.
      await deps.ensureShellPath()
      const session = deps.manager.create({
        cwd,
        projectPath: opts.projectPath,
        title: opts.title ?? (basename(cwd) || 'Terminal'),
        cols: opts.cols,
        rows: opts.rows,
        openedInActivity: opts.openedInActivity,
      })
      return session.listItem()
    },
  )
  deps.ipc.handle(AgentIpcChannels.TERMINAL_LIST, (_e, cwd?: string) => {
    if (cwd && parseRemoteProjectKey(cwd)) return deps.remote.list(cwd)
    const local = deps.manager.list(cwd)
    return cwd === undefined ? [...local, ...deps.remote.list()] : local
  })
  deps.ipc.handle(AgentIpcChannels.TERMINAL_SNAPSHOT, async (_e, terminalId: string) => {
    if (deps.remote.has(terminalId)) {
      return deps.remote.snapshot(terminalId)
    }
    const session = deps.manager.get(terminalId)
    if (!session) return null
    return session.snapshot('local')
  })
  deps.ipc.handle(AgentIpcChannels.TERMINAL_WRITE, async (_e, terminalId: string, data: string) => {
    if (deps.remote.has(terminalId)) {
      await deps.remote.write(terminalId, data)
      return
    }
    const session = deps.manager.get(terminalId)
    if (session) { session.lease.assertWindow(_e.sender.id); session.input(data) }
  })
  deps.ipc.handle(AgentIpcChannels.TERMINAL_RESIZE, async (_e, terminalId: string, cols: number, rows: number) => {
    if (deps.remote.has(terminalId)) {
      await deps.remote.resize(terminalId, cols, rows)
      return
    }
    const session = deps.manager.get(terminalId)
    if (session) { session.lease.assertWindow(_e.sender.id); session.resize(cols, rows) }
  })
  deps.ipc.handle(AgentIpcChannels.TERMINAL_KILL, async (_e, terminalId: string) => {
    if (deps.remote.has(terminalId)) {
      await deps.remote.kill(terminalId)
      return
    }
    deps.manager.get(terminalId)?.lease.assertWindow(_e.sender.id)
    deps.manager.kill(terminalId)
  })
  deps.ipc.handle(AgentIpcChannels.TERMINAL_CLAIM, (_e, terminalId: string) => {
    if (deps.remote.has(terminalId)) return
    deps.manager.get(terminalId)?.lease.reclaimLocal(_e.sender.id)
  })
}
