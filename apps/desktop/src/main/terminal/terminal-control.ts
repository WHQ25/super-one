import type { TerminalAgentControl, TerminalEvent } from '@superone/shared/agent-types'

/**
 * Agent control of one tab, bounded by the approved command's lifetime
 * (docs/design/terminal-agent-tools.md §5–§6).
 *
 * "Control" means: the command the user approved is the tab's foreground process.
 * Keystrokes while it runs are input *to that program*; once the shell is back at
 * its prompt any further input would be a new command, so control is released and
 * the agent has to ask again. The boundary is read from the PTY's foreground
 * process group, which is the only signal that tells a REPL's stdin apart from a
 * shell's — the bytes look the same.
 */

export type ControlReleaseReason = 'command_exited' | 'user_took_over' | 'terminal_exited'

export interface ControlledTerminal {
  readonly terminalId: string
  /** True when the foreground process is the shell itself (prompt). */
  isAtShell(): boolean
  /** Timestamp of the last PTY output. */
  lastOutputAt(): number
  emit(event: TerminalEvent): void
}

export interface TerminalControlOptions {
  pollMs?: number
  /** How long a granted command may stay unobserved before it counts as already exited. */
  startGraceMs?: number
  /** Output must have been quiet this long before an unobserved command counts as exited. */
  idleMs?: number
  now?: () => number
}

const DEFAULT_POLL_MS = 200
const DEFAULT_START_GRACE_MS = 3_000
const DEFAULT_IDLE_MS = 400

export class TerminalControl {
  private control: TerminalAgentControl | null = null
  /** Why the last grant ended — lets a rejected write say "the user took over" rather than "exited". */
  lastReleaseReason: ControlReleaseReason | null = null
  /** The command was seen as the foreground process at least once. */
  private commandSeen = false
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly pollMs: number
  private readonly startGraceMs: number
  private readonly idleMs: number
  private readonly now: () => number

  constructor(private readonly terminal: ControlledTerminal, opts: TerminalControlOptions = {}) {
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS
    this.startGraceMs = opts.startGraceMs ?? DEFAULT_START_GRACE_MS
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS
    this.now = opts.now ?? Date.now
  }

  get current(): TerminalAgentControl | null {
    return this.control
  }

  /** Whether `sessionId` may write to the tab right now. */
  heldBy(sessionId: string): boolean {
    return this.control?.sessionId === sessionId
  }

  /** The approved command is running (was observed in the foreground and has not returned). */
  get commandRunning(): boolean {
    return this.control !== null && this.commandSeen && !this.terminal.isAtShell()
  }

  grant(control: TerminalAgentControl): void {
    this.stop()
    this.control = control
    this.commandSeen = false
    this.terminal.emit({ type: 'terminal_control_changed', terminalId: this.terminal.terminalId, control, reason: 'granted' })
    this.timer = setInterval(() => this.poll(), this.pollMs)
  }

  release(reason: ControlReleaseReason): void {
    if (!this.control) return
    this.stop()
    this.control = null
    this.commandSeen = false
    this.lastReleaseReason = reason
    this.terminal.emit({ type: 'terminal_control_changed', terminalId: this.terminal.terminalId, control: null, reason })
  }

  /** One observation of the foreground process; exposed so callers can force a check. */
  poll(): void {
    const control = this.control
    if (!control) return
    const atShell = this.terminal.isAtShell()
    if (!atShell) {
      this.commandSeen = true
      return
    }
    if (this.commandSeen) {
      this.release('command_exited')
      return
    }
    // Never seen: either the shell is still parsing the line, or the command finished
    // inside one poll interval. Give it the grace window, then require quiet output —
    // a prompt that has been silent is not about to start anything.
    const now = this.now()
    if (now - control.startedAt >= this.startGraceMs && now - this.terminal.lastOutputAt() >= this.idleMs) {
      this.release('command_exited')
    }
  }

  dispose(): void {
    if (this.control) this.release('terminal_exited')
    this.stop()
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
