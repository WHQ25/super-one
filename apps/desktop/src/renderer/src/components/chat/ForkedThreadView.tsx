import { useMemo } from 'react'
import { ArrowLeft, GitBranch } from 'lucide-react'
import type { CodexCollabToolCallItem, CodexThreadItem, ChatMessage } from '@superone/shared/agent-types'
import { useActiveSession } from '@/stores/chat'
import { useForkNavigation, type ForkViewState } from './fork-navigation-context'
import { renderCodexItem } from './codex-item-renderer'

function findCollabItem(messages: ChatMessage[], collabId: string): CodexCollabToolCallItem | null {
  for (const msg of messages) {
    const codex = msg.metadata?.codex as { items?: CodexThreadItem[] } | undefined
    const items = codex?.items
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (item.type === 'collab_tool_call' && item.id === collabId) return item
    }
  }
  return null
}

export function ForkedThreadView({ fork }: { fork: ForkViewState }) {
  const forkNav = useForkNavigation()
  const messages = useActiveSession((s) => s.messages)
  const sessionStatus = useActiveSession((s) => s.status)
  const mainIsStreaming = sessionStatus === 'streaming'
  const collab = useMemo(() => findCollabItem(messages, fork.collabId), [messages, fork.collabId])
  const childItems = collab?.childItems?.[fork.threadId] ?? []

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-2 text-xs">
        <button
          type="button"
          onClick={() => forkNav.close()}
          className="inline-flex items-center gap-1 rounded border border-border/50 bg-background px-2 py-0.5 text-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-3" /> Main
        </button>
        <span className="text-muted-foreground">›</span>
        <GitBranch className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 truncate font-medium text-foreground">
          Forked branch{collab?.prompt ? ` · "${collab.prompt}"` : ''}
        </span>
        {mainIsStreaming && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-green-600 dark:bg-green-400" />
            Main is still running
          </span>
        )}
      </div>

      <div className="chat-md flex-1 overflow-y-auto px-3 py-3">
        {childItems.length === 0 ? (
          <div className="text-xs text-muted-foreground">No items yet in this branch.</div>
        ) : (
          childItems.map((item, i) => renderCodexItem(item, i, false, childItems[i + 1]))
        )}
      </div>
    </div>
  )
}
