import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Bot } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import type { CodexCollabTool, CodexThreadItem, ChatMessage } from '@superone/shared/agent-types'
import { useActiveSession } from '@/stores/chat'
import { useForkNavigation, type ForkViewState } from './fork-navigation-context'
import { renderCodexItem } from './codex-item-renderer'
import { getSubagentColorClasses } from './subagent-colors'

interface ForkTurn {
  collabId: string
  tool: CodexCollabTool
  prompt: string
  items: CodexThreadItem[]
}

function collectForkTurns(messages: ChatMessage[], threadId: string): {
  turns: ForkTurn[]
  nickname?: string
  role?: string
  forked: boolean
} {
  const turns: ForkTurn[] = []
  let nickname: string | undefined
  let role: string | undefined
  let forked = false
  const seen = new Set<string>()
  for (const msg of messages) {
    const codex = msg.metadata?.codex as { items?: CodexThreadItem[] } | undefined
    const items = codex?.items
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (item.type !== 'collab_tool_call') continue
      if (!(threadId in item.agentsStates)) continue
      const st = item.agentsStates[threadId]
      if (!nickname && st?.nickname) nickname = st.nickname
      if (!role && st?.role) role = st.role
      if (st?.forkedFromId) forked = true
      if (seen.has(item.id)) continue
      seen.add(item.id)
      turns.push({
        collabId: item.id,
        tool: item.tool,
        prompt: item.prompt ?? '',
        items: item.childItems?.[threadId] ?? [],
      })
    }
  }
  return { turns, nickname, role, forked }
}

export function ForkedThreadView({ fork }: { fork: ForkViewState }) {
  const { t } = useTranslation()
  const forkNav = useForkNavigation()
  const messages = useActiveSession((s) => s.messages)
  const colorIdx = useActiveSession((s) => s.subagentColors[fork.threadId])

  const { turns, nickname, role, forked } = useMemo(
    () => collectForkTurns(messages, fork.threadId),
    [messages, fork.threadId],
  )
  const name = nickname ?? t('chat.codexCollab.defaultName')
  const badge = forked ? t('chat.codexCollab.forked') : role
  const colors = useMemo(() => getSubagentColorClasses(colorIdx), [colorIdx])
  const totalItems = useMemo(() => turns.reduce((sum, t) => sum + t.items.length, 0), [turns])
  const backLabel = t('chat.codexCollab.backToMain')

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-2 text-xs">
        <button
          type="button"
          onClick={() => forkNav.close()}
          title={backLabel}
          aria-label={backLabel}
          className="inline-flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <Bot className={cn('size-3.5 shrink-0', colors.text)} />
        <span className="min-w-0 truncate font-medium text-foreground">{name}</span>
        {badge && (
          <span className={cn('shrink-0 rounded px-1 py-px text-[10px]', colors.tagBg, colors.tagText)}>
            {badge}
          </span>
        )}
        <span className="ml-auto inline-flex shrink-0 items-center text-[11px] text-muted-foreground tabular-nums">
          {t('chat.codexCollab.turnCount', { count: turns.length })}
        </span>
      </div>

      <div className="chat-md flex-1 overflow-y-auto px-3 py-3">
        {totalItems === 0 && turns.length === 0 ? (
          <div className="text-xs text-muted-foreground">{t('chat.codexCollab.noItems')}</div>
        ) : (
          turns.map((turn, ti) => (
            <div key={turn.collabId} className={cn(ti > 0 && 'mt-4 border-t border-border/30 pt-4')}>
              {turn.prompt && (
                <div className="mb-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <span>{t(`chat.codexCollab.turnLabels.${turn.tool}`)}</span>
                  </div>
                  <div className={cn('whitespace-pre-wrap rounded border-l-2 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-foreground', colors.borderL)}>
                    {turn.prompt}
                  </div>
                </div>
              )}
              {turn.items.length === 0 ? (
                <div className="text-[11px] text-muted-foreground">{t('chat.codexCollab.noOutput')}</div>
              ) : (
                turn.items.map((item, i) => renderCodexItem(item, i, false, turn.items[i + 1]))
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
