import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, Search } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { BeeIcon } from '@superone/chat-view/presenters/SubagentBlock'
import type { SwarmBoardSnapshot } from '@superone/shared/swarm-board-types'
import { cn } from '@superone/ui/lib/utils'
import {
  streamdownComponents,
  streamdownControls,
  streamdownLinkSafety,
  streamdownPlugins,
  streamdownRehypePlugins,
} from '@/components/chat/chat-shared'
import { getMemberPalette } from './swarm-board-utils'

interface SwarmBoardMessagesTabProps {
  snapshot: SwarmBoardSnapshot
  memberColorMap?: Record<string, number>
  selectedSender: string | null
  onSelectSender: (sender: string | null) => void
}

export function SwarmBoardMessagesTab({
  snapshot,
  memberColorMap = {},
  selectedSender,
  onSelectSender,
}: SwarmBoardMessagesTabProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  const senders = useMemo(() => {
    const names = new Set<string>()
    for (const m of snapshot.members) names.add(m.name)
    for (const msg of snapshot.messages) names.add(msg.agent)
    return Array.from(names)
  }, [snapshot.members, snapshot.messages])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return snapshot.messages.filter((msg) => {
      if (selectedSender && msg.agent !== selectedSender && !msg.mentions.includes(selectedSender)) {
        return false
      }
      if (!q) return true
      return (
        msg.text.toLowerCase().includes(q) ||
        msg.agent.toLowerCase().includes(q) ||
        `#${msg.seq}`.includes(q)
      )
    })
  }, [snapshot.messages, selectedSender, query])

  const scrollToLatest = () => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border/60 px-4 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('swarmBoard.board.searchPlaceholder')}
            className="h-8 w-full rounded-lg border border-border/70 bg-muted/30 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-border focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => onSelectSender(null)}
            className={cn(
              'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
              selectedSender === null
                ? 'bg-foreground text-background'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t('swarmBoard.board.allSenders')}
          </button>
          {senders.map((name) => {
            const active = selectedSender === name
            return (
              <button
                key={name}
                type="button"
                onClick={() => onSelectSender(active ? null : name)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
                  active
                    ? 'bg-foreground text-background'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                @{name}
              </button>
            )
          })}
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            {t('swarmBoard.board.noMessages')}
          </div>
        ) : (
          filtered.map((msg) => {
            const palette = getMemberPalette(msg.agent, memberColorMap[msg.agent.toLowerCase()])
            const isCoordinator = msg.agent === 'coordinator'
            return (
              <div
                key={msg.seq}
                className="rounded-xl border border-border/60 bg-card/40 p-3 text-xs transition-colors hover:border-border"
              >
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-md border',
                      palette.bg,
                      palette.border,
                      palette.text,
                    )}
                  >
                    <BeeIcon color={palette.hex} crowned={isCoordinator} className="size-4" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-foreground">@{msg.agent}</span>
                    {msg.mentions.length > 0 && (
                      <>
                        <span className="text-muted-foreground">→</span>
                        <span className="truncate text-muted-foreground">
                          {msg.mentions.map((m) => `@${m}`).join(' ')}
                        </span>
                      </>
                    )}
                    {msg.channel && msg.channel !== 'main' && (
                      <span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                        #{msg.channel}
                      </span>
                    )}
                    {msg.isDone && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        done
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    #{msg.seq}
                    {msg.time ? ` · ${msg.time.split(' ')[1] ?? msg.time}` : ''}
                  </span>
                </div>
                <div className="mt-2 pl-8 text-xs leading-relaxed text-foreground/90">
                  <Streamdown
                    className="chat-md text-xs"
                    plugins={streamdownPlugins}
                    rehypePlugins={streamdownRehypePlugins}
                    components={streamdownComponents}
                    controls={streamdownControls}
                    linkSafety={streamdownLinkSafety}
                  >
                    {msg.text}
                  </Streamdown>
                </div>
              </div>
            )
          })
        )}
      </div>

      {filtered.length > 3 && (
        <button
          type="button"
          onClick={scrollToLatest}
          className="absolute bottom-3 right-4 flex items-center gap-1 rounded-full border border-border bg-background/95 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted"
        >
          <ArrowDown className="size-3" />
          {t('swarmBoard.board.latest')}
        </button>
      )}
    </div>
  )
}
