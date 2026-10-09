import type { CodexCommandAction, CodexCommandExecutionItem } from './agent-types'
import { literalReadActions } from './codex-literal-reads'

export type CodexCommandKind = 'read' | 'search' | 'list' | 'explore' | 'bash'

export function resolveCodexCommandActions(item: CodexCommandExecutionItem, cwdFallback?: string): CodexCommandAction[] {
  const actions = item.commandActions ?? []
  // Supplement only wholly literal read commands; never discard search/list/unknown
  // actions from a compound command that this grammar cannot understand.
  if (actions.every(action => action.type === 'read' || action.type === 'unknown')) {
    const cwd = item.cwd ?? cwdFallback
    const reads = literalReadActions(item.command, cwd)
    if (reads) {
      const paths = new Set(reads.map(read => read.path))
      const knownReads = actions.filter(action => action.type === 'read')
      if (reads.length < knownReads.length || knownReads.some(action => action.path && !paths.has(action.path))) return actions
    }
    // Legacy items lack cwd. Keep authoritative absolute paths rather than
    // replacing them with operands relative to an unknown execution directory.
    if (reads && (cwd || reads.every(action => action.path?.startsWith('/')) || !actions.some(action => action.type === 'read'))) return reads
  }
  return actions.flatMap(action => {
    if (action.type !== 'read' || !action.command || !action.path) return [action]
    const reads = literalReadActions(action.command, item.cwd ?? cwdFallback)
    // A normalized multi-file command already has one action per operand.
    // Projected action.command can also be truncated; do not expand it again.
    if (reads && actions.filter(entry => entry.type === 'read' && entry.command === action.command).length >= reads.length) return [action]
    // A preceding cd may give an action a different directory from item.cwd.
    // Expand only when the first operand agrees with Codex's resolved path.
    return reads && reads[0]?.path === action.path ? reads : [action]
  })
}

export function codexCommandPresentation(item: CodexCommandExecutionItem, cwdFallback?: string) {
  const actions = resolveCodexCommandActions(item, cwdFallback)
  const types = new Set(actions.map(action => action.type))
  let kind: CodexCommandKind = 'bash'
  if (actions.length && actions.every(action => ['read', 'search', 'listFiles'].includes(action.type))) {
    kind = types.size > 1 ? 'explore' : types.has('read') ? 'read' : types.has('search') ? 'search' : 'list'
  }
  const files = [...new Set(actions.filter(action => action.type === 'read' && action.path).map(action => action.path!))]
  return { kind, actions, files }
}

export function summarizeCodexCommandActions(items: CodexCommandExecutionItem[]) {
  const files = new Set<string>()
  let searches = 0, lists = 0
  for (const item of items) {
    const view = codexCommandPresentation(item)
    for (const file of view.files) files.add(file)
    searches += view.actions.filter(action => action.type === 'search').length
    lists += view.actions.filter(action => action.type === 'listFiles').length
  }
  return { files: files.size, searches, lists }
}
