import { basename } from 'node:path'
import type { TerminalEvent, TerminalListItem, TerminalSnapshot } from '@superone/shared/agent-types'
import { parseRemoteProjectKey, remoteTerminalKey } from '@superone/shared/remote-resource-key'
import type { EnvironmentHost } from './environment-host'

interface RemoteTerminalState {
  terminalId: string
  remoteTerminalId: string
  connectionId: string
  projectPath: string
  cwd: string
  title: string
  cols: number
  rows: number
  status: 'running' | 'exited'
  sequence: number
  exitEmitted: boolean
  stopped: boolean
  timer: ReturnType<typeof setTimeout> | null
  readQueue: Promise<void>
}

export interface RemoteTerminalControllerOptions {
  getHost: () => EnvironmentHost | Promise<EnvironmentHost>
  onEvent: (event: TerminalEvent) => void
  pollMs?: number
}

export class RemoteTerminalController {
  private readonly terminals = new Map<string, RemoteTerminalState>()
  private readonly pollMs: number

  constructor(private readonly options: RemoteTerminalControllerOptions) {
    this.pollMs = options.pollMs ?? 50
  }

  has(terminalId: string): boolean {
    return this.terminals.has(terminalId)
  }

  async create(input: {
    projectPath: string
    sessionId?: string
    title?: string
    cols?: number
    rows?: number
  }): Promise<TerminalListItem> {
    const remote = parseRemoteProjectKey(input.projectPath)
    if (!remote) throw new Error('remote project path required')
    const host = await this.options.getHost()
    let cwd = remote.path
    if (input.sessionId) {
      try {
        const session = (await host.getSession(remote.connectionId, input.sessionId)) as {
          cwd?: string
        } | null
        if (session?.cwd) cwd = session.cwd
      } catch {
        // A terminal can still open at the project root if session hydration lags.
      }
    }

    const title = input.title ?? (basename(cwd) || 'Terminal')
    const created = await host.createRemoteTerminal(remote.connectionId, {
      cwd,
      title,
      cols: input.cols,
      rows: input.rows,
    })
    const terminalId = remoteTerminalKey(remote.connectionId, created.terminalId)
    const state: RemoteTerminalState = {
      terminalId,
      remoteTerminalId: created.terminalId,
      connectionId: remote.connectionId,
      projectPath: input.projectPath,
      cwd,
      title,
      cols: input.cols ?? 80,
      rows: input.rows ?? 24,
      status: 'running',
      sequence: 0,
      exitEmitted: false,
      stopped: false,
      timer: null,
      readQueue: Promise.resolve(),
    }
    this.terminals.set(terminalId, state)
    this.schedule(state, 0)
    return this.listItem(state)
  }

  list(projectPath?: string): TerminalListItem[] {
    return [...this.terminals.values()]
      .filter((state) => projectPath === undefined || state.projectPath === projectPath)
      .map((state) => this.listItem(state))
  }

  async snapshot(terminalId: string): Promise<TerminalSnapshot | null> {
    const state = this.terminals.get(terminalId)
    if (!state) return null
    return this.enqueue(state, async () => {
      const host = await this.options.getHost()
      const attached = await host.attachRemoteTerminal(state.connectionId, state.remoteTerminalId)
      state.sequence = Number(attached.sequence)
      const snapshot = this.snapshotInfo(state)
      this.options.onEvent({
        type: 'terminal_snapshot',
        terminalId: state.terminalId,
        snapshot,
        ansi: attached.snapshot,
      })
      return snapshot
    })
  }

  async write(terminalId: string, data: string): Promise<void> {
    const state = this.terminals.get(terminalId)
    if (!state || state.status !== 'running') return
    const host = await this.options.getHost()
    await host.writeRemoteTerminal(state.connectionId, state.remoteTerminalId, data)
  }

  async resize(terminalId: string, cols: number, rows: number): Promise<void> {
    const state = this.terminals.get(terminalId)
    if (!state || state.status !== 'running') return
    state.cols = cols
    state.rows = rows
    const host = await this.options.getHost()
    await host.resizeRemoteTerminal(state.connectionId, state.remoteTerminalId, cols, rows)
  }

  async kill(terminalId: string): Promise<void> {
    const state = this.terminals.get(terminalId)
    if (!state) return
    state.stopped = true
    if (state.timer) clearTimeout(state.timer)
    this.terminals.delete(terminalId)
    const host = await this.options.getHost()
    await host.killRemoteTerminal(state.connectionId, state.remoteTerminalId)
  }

  dispose(): void {
    for (const state of this.terminals.values()) {
      state.stopped = true
      if (state.timer) clearTimeout(state.timer)
    }
    this.terminals.clear()
  }

  private listItem(state: RemoteTerminalState): TerminalListItem {
    return {
      terminalId: state.terminalId,
      cwd: state.cwd,
      title: state.title,
      status: state.status,
      ownerDeviceId: null,
    }
  }

  private snapshotInfo(state: RemoteTerminalState): TerminalSnapshot {
    return {
      terminalId: state.terminalId,
      cwd: state.cwd,
      title: state.title,
      status: state.status,
      cols: state.cols,
      rows: state.rows,
      lastSeq: state.sequence,
      ownerDeviceId: null,
      writableByMe: state.status === 'running',
      subscriberCount: 0,
    }
  }

  private enqueue<T>(state: RemoteTerminalState, task: () => Promise<T>): Promise<T> {
    const result = state.readQueue.then(task, task)
    state.readQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private schedule(state: RemoteTerminalState, delay = this.pollMs): void {
    if (state.stopped || state.status === 'exited') return
    state.timer = setTimeout(() => {
      state.timer = null
      void this.enqueue(state, () => this.readAndEmit(state))
        .catch(() => {})
        .finally(() => this.schedule(state))
    }, delay)
  }

  private async readAndEmit(state: RemoteTerminalState): Promise<void> {
    if (state.stopped) return
    const host = await this.options.getHost()
    const result = await host.readRemoteTerminal(state.connectionId, state.remoteTerminalId, String(state.sequence))
    const sequence = Number(result.sequence)
    if (result.reset) {
      state.sequence = sequence
      this.options.onEvent({
        type: 'terminal_snapshot',
        terminalId: state.terminalId,
        snapshot: this.snapshotInfo(state),
        ansi: result.snapshot ?? '',
      })
    } else if (result.data && sequence > state.sequence) {
      const fromSeq = Number(result.fromSequence)
      this.options.onEvent({
        type: 'terminal_output',
        terminalId: state.terminalId,
        data: result.data,
        fromSeq,
        toSeq: sequence,
        createdAt: Date.now(),
      })
      state.sequence = sequence
    } else {
      state.sequence = Math.max(state.sequence, sequence)
    }

    if (result.status === 'exited' && !state.exitEmitted) {
      state.status = 'exited'
      state.exitEmitted = true
      this.options.onEvent({
        type: 'terminal_exited',
        terminalId: state.terminalId,
        exitCode: result.exitCode,
        signal: null,
      })
    }
  }
}
