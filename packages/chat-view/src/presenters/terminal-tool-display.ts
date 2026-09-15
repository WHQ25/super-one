export type TerminalOp = 'tabs' | 'snapshot' | 'act' | 'waitFor'

const OPS: Record<string, TerminalOp> = {
  terminal_tabs: 'tabs',
  terminal_snapshot: 'snapshot',
  terminal_act: 'act',
  terminal_wait_for: 'waitFor',
}

/** Bare SuperOne tool name → terminal presenter op, or null for any other tool. */
export function getTerminalOp(bareToolName: string): TerminalOp | null {
  return OPS[bareToolName] ?? null
}

export type TerminalTabsAction = 'list' | 'run' | 'attach' | 'close'

export function terminalTabsAction(params: Record<string, unknown>): TerminalTabsAction {
  const action = params.action
  return action === 'run' || action === 'attach' || action === 'close' ? action : 'list'
}

export interface TerminalToolOutcome {
  data: Record<string, unknown> | null
  /** `count:` from a TOON list reply. */
  listCount: number | null
  status: string | null
  reason: string | null
  screen: string[] | null
}

export function parseTerminalResult(result: string | undefined): TerminalToolOutcome {
  const empty: TerminalToolOutcome = { data: null, listCount: null, status: null, reason: null, screen: null }
  if (!result) return empty
  const trimmed = result.trim()
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed) as Record<string, unknown>
      return {
        data,
        listCount: null,
        status: typeof data.status === 'string' ? data.status : null,
        reason: typeof data.reason === 'string' ? data.reason : null,
        screen: Array.isArray(data.screen) ? data.screen.filter((line): line is string => typeof line === 'string') : null,
      }
    } catch {
      return empty
    }
  }
  const count = /^count:\s*(\d+)/m.exec(trimmed)
  return { ...empty, listCount: count ? Number(count[1]) : null }
}

/** One human line for an act batch: `typed "npm init" · pressed Enter ×2`. */
export function describeTerminalActions(
  actions: unknown,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!Array.isArray(actions)) return ''
  return actions.map((raw) => {
    const action = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    switch (action.type) {
      case 'type':
        return t('chat.toolBlock.terminal.actions.typed', { text: truncate(String(action.text ?? ''), 40) })
      case 'key': {
        const repeat = typeof action.repeat === 'number' && action.repeat > 1 ? ` ×${action.repeat}` : ''
        return `${t('chat.toolBlock.terminal.actions.pressed', { key: String(action.key ?? '') })}${repeat}`
      }
      case 'raw':
        return t('chat.toolBlock.terminal.actions.raw')
      case 'resize':
        return t('chat.toolBlock.terminal.actions.resized', { cols: action.cols, rows: action.rows })
      case 'wait':
        return t('chat.toolBlock.terminal.actions.waited', { ms: action.ms })
      default:
        return ''
    }
  }).filter(Boolean).join(' · ')
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
