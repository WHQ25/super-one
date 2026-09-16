import { existsSync } from 'node:fs'
import type { TerminalEvent, TerminalListItem } from '@superone/shared/agent-types'
import type { PtySpawner } from './pty'
import { TerminalOwnership } from './terminal-ownership'
import { TerminalSession } from './terminal-session'

export interface TerminalManagerOptions {
  spawner: PtySpawner
  onEvent: (event: TerminalEvent) => void
  exists?: (path: string) => boolean
  coalesceMs?: number
  snapshotSoftLimit?: number
}

export function terminalMatchesProject(cwd: string, projectPath: string, sessionCwd?: string): boolean {
  if (cwd === projectPath || (sessionCwd !== undefined && cwd === sessionCwd)) return true
  const root = projectPath.endsWith('/') ? projectPath : `${projectPath}/`
  return cwd.startsWith(root)
}

export interface CreateTerminalOptions {
  cwd: string
  projectPath?: string
  title?: string
  cols?: number
  rows?: number
  env?: Record<string, string>
  shell?: string
  /** Session whose agent tool opened the tab — docked in that session's activity panel. */
  agentSessionId?: string
}

export class TerminalManager {
  private readonly opts: TerminalManagerOptions
  private readonly exists: (path: string) => boolean
  private readonly byId = new Map<string, TerminalSession>()

  constructor(opts: TerminalManagerOptions) {
    this.opts = opts
    this.exists = opts.exists ?? existsSync
  }

  create(opts: CreateTerminalOptions): TerminalSession {
    const terminalId = globalThis.crypto.randomUUID()
    const session = new TerminalSession({
      terminalId,
      cwd: opts.cwd,
      projectPath: opts.projectPath,
      title: opts.title ?? 'Terminal',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      spawner: this.opts.spawner,
      ownership: new TerminalOwnership(),
      onEvent: this.opts.onEvent,
      env: opts.env,
      shell: opts.shell,
      agentSessionId: opts.agentSessionId,
      coalesceMs: this.opts.coalesceMs,
      snapshotSoftLimit: this.opts.snapshotSoftLimit,
    })
    this.byId.set(terminalId, session)
    this.notifyCreated(terminalId)
    return session
  }

  notifyCreated(terminalId: string): void {
    const session = this.byId.get(terminalId)
    if (!session) return
    this.opts.onEvent({ type: 'terminal_created', terminalId, item: session.listItem() })
  }

  get(terminalId: string): TerminalSession | undefined {
    return this.byId.get(terminalId)
  }

  list(cwd?: string): TerminalListItem[] {
    const items: TerminalListItem[] = []
    for (const session of this.byId.values()) {
      if (cwd === undefined || session.cwd === cwd) items.push(session.listItem())
    }
    return items
  }

  /**
   * Every tab the desktop would show for this folder: the project root, the
   * session checkout (a worktree may sit beside the project), and anything
   * nested under the project path.
   */
  listForProject(projectPath: string, sessionCwd?: string): TerminalListItem[] {
    return this.list().filter((item) => terminalMatchesProject(item.cwd, projectPath, sessionCwd))
  }

  kill(terminalId: string): void {
    const session = this.byId.get(terminalId)
    if (!session) return
    session.kill()
    this.byId.delete(terminalId)
  }

  invalidateCwd(path: string): void {
    for (const [id, session] of [...this.byId]) {
      if (session.cwd !== path) continue
      session.forceExit()
      this.byId.delete(id)
    }
  }

  sweep(): void {
    const seen = new Set<string>()
    for (const session of this.byId.values()) seen.add(session.cwd)
    for (const cwd of seen) {
      if (!this.exists(cwd)) this.invalidateCwd(cwd)
    }
  }

  killAll(): void {
    for (const id of [...this.byId.keys()]) this.kill(id)
  }
}
