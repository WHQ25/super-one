import type { CodexCollabToolCallItem } from '@superone/shared/agent-types'

/** App branches stay in the live phone shell; fetched detail can be older. */
export function mergeCodexCollabDetail(shell: CodexCollabToolCallItem, detail: CodexCollabToolCallItem): CodexCollabToolCallItem {
  const childItems = { ...detail.childItems }
  for (const [threadId, live] of Object.entries(shell.childItems ?? {})) {
    const rows = new Map((childItems[threadId] ?? []).map(item => [item.id, item]))
    for (const item of live) {
      const previous = rows.get(item.id)
      if (item.type === 'mcp_tool_call' && item.app) rows.set(item.id, item)
      else if (item.type === 'collab_tool_call') rows.set(item.id,
        previous?.type === 'collab_tool_call' ? mergeCodexCollabDetail(item, previous) : item)
    }
    childItems[threadId] = [...rows.values()]
  }
  return { ...detail, childItems }
}
