import { basename } from 'node:path'
import type { TerminalEvent } from '@superone/shared/agent-types'
import type { TerminalReadResult } from '@superone/shared/environment'
import type { TerminalsPort } from '@superone/runtime/server'
import { ensureShellPath } from '../shell-path'
import type { TerminalManager } from '../terminal/terminal-manager'
import type { TerminalSession } from '../terminal/terminal-session'

function notFound(): Error {
  return Object.assign(new Error('terminal not found'), { code: 'not_found' })
}

/**
 * This desktop's PTYs as the shared terminal port: the tabs its window shows,
 * pushed to readers through `onEvent`. The desktop keeps the screen, not an
 * output buffer, so a reader that is behind gets the screen again.
 */
export function createDesktopTerminalsPort(
  manager: TerminalManager,
  onEvent: (listener: (event: TerminalEvent) => void) => () => void,
): TerminalsPort {
  const live = (terminalId: string): TerminalSession => manager.get(terminalId) ?? (() => { throw notFound() })()
  return {
    list: () => manager.list(),
    create: (opts) => {
      void ensureShellPath()
      const term = manager.create({ cwd: opts.cwd, projectPath: opts.projectPath, title: opts.title ?? (basename(opts.cwd) || 'Terminal'), cols: opts.cols, rows: opts.rows })
      return { terminalId: term.terminalId, cwd: term.cwd, title: term.title, cols: term.cols, rows: term.rows }
    },
    attach: async (terminalId, clientSessionId) => {
      const requester = clientSessionId?.startsWith('phone:') ? clientSessionId.slice(6) : 'local'
      const { snapshot, ansi } = await live(terminalId).attachState(requester)
      return { snapshot: ansi, sequence: String(snapshot.lastSeq), terminal: snapshot }
    },
    readAfter: async (terminalId, afterSequence): Promise<TerminalReadResult> => {
      const term = live(terminalId)
      const sequence = String(term.outputSequence)
      const status = term.status === 'running' ? 'running' : 'exited'
      if (afterSequence === sequence) return { data: '', fromSequence: sequence, sequence, reset: false, status, exitCode: null }
      const { snapshot, ansi } = await term.attachState('local')
      const cut = String(snapshot.lastSeq)
      return { data: '', fromSequence: cut, sequence: cut, reset: true, snapshot: ansi, status, exitCode: null }
    },
    write: (terminalId, data) => live(terminalId).input(data),
    resize: (terminalId, cols, rows) => live(terminalId).resize(cols, rows),
    kill: (terminalId) => {
      live(terminalId)
      manager.kill(terminalId)
    },
    onEvent,
    eventForClient: (event, clientSessionId) => event.type === 'terminal_owner_changed'
      ? { ...event, writableByMe: clientSessionId === `phone:${event.ownerDeviceId}` }
      : event,
  }
}
