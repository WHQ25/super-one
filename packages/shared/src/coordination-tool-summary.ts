/**
 * Header summaries for Claude's coordination tools — messaging other agents and
 * moving the session between worktrees. One derivation for the desktop row
 * (`getToolDisplay`) and the phone's precomputed `toolSummary` (`computeToolMeta`),
 * which only ever sees the summary because the phone's input is stripped.
 */
export function coordinationToolSummary(
  toolName: string,
  input: Record<string, unknown>,
  shortenPath: (path: string) => string,
): string | null {
  switch (toolName) {
    case 'SendMessage': {
      // Recipient, then the sender's own row label, else the preview line the recipient sees.
      const to = typeof input.to === 'string' ? input.to.trim() : ''
      const label = typeof input.summary === 'string' && input.summary.trim()
        ? input.summary.trim()
        : messagePreview(input.message)
      return [to, label].filter(Boolean).join(' · ')
    }
    // The report is the whole call; its first line is what the caller is told.
    case 'SubagentHandback':
      return firstLine(input.message)
    case 'EnterWorktree':
      return typeof input.path === 'string' && input.path ? shortenPath(input.path) : typeof input.name === 'string' ? input.name : ''
    case 'ExitWorktree':
      if (input.action !== 'keep' && input.action !== 'remove') return ''
      return input.action === 'remove' && input.discard_changes === true ? 'remove · discard changes' : input.action
    default:
      return null
  }
}

/** A protocol reply (shutdown / plan approval) is an object; its type is the story. */
function messagePreview(message: unknown): string {
  if (message && typeof message === 'object') {
    const type = (message as Record<string, unknown>).type
    return typeof type === 'string' ? type : ''
  }
  return firstLine(message)
}

function firstLine(value: unknown): string {
  return typeof value === 'string' ? value.trim().split('\n', 1)[0] ?? '' : ''
}
