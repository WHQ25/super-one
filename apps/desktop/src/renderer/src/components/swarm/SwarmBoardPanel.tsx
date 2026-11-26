import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Hexagon, RefreshCw } from 'lucide-react'
import type { SwarmBoardSnapshot } from '@superone/shared/swarm-board-types'
import { cn } from '@superone/ui/lib/utils'
import { useChatStore } from '@/stores/chat'
import { parseTaskInput } from '@/components/chat/subagent-utils'
import { SwarmBoardMessagesTab } from './SwarmBoardMessagesTab'
import { SwarmGraphTab } from './SwarmGraphTab'
import { SwarmMembersTab } from './SwarmMembersTab'
import { SwarmOverviewTab } from './SwarmOverviewTab'

type SwarmTab = 'overview' | 'board' | 'members' | 'graph'

export interface SwarmBoardPanelProps {
  sessionId: string
  initialSnapshot?: SwarmBoardSnapshot | null
}

export function SwarmBoardPanel({ sessionId, initialSnapshot }: SwarmBoardPanelProps) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<SwarmBoardSnapshot | null>(initialSnapshot ?? null)
  const [loading, setLoading] = useState(initialSnapshot === undefined)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<SwarmTab>('overview')
  const [selectedSender, setSelectedSender] = useState<string | null>(null)

  const sessionState = useChatStore((s) => {
    for (const proj of Object.values(s.projectSessions)) {
      if (proj._sessions[sessionId]) return proj._sessions[sessionId]
    }
    return undefined
  })

  const { memberColorMap, memberToolUseIdMap } = useMemo(() => {
    if (!sessionState) return { memberColorMap: {} as Record<string, number>, memberToolUseIdMap: {} as Record<string, string> }
    const colorMap: Record<string, number> = {}
    const toolMap: Record<string, string> = {}
    for (const msg of sessionState.messages) {
      if (!Array.isArray(msg.content)) continue
      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue
        if (block.toolName !== 'Agent' && block.toolName !== 'Task') continue
        const parsed = parseTaskInput(block.input)
        const key = (parsed.name || parsed.subagentType).trim().toLowerCase()
        if (!key) continue
        if (toolMap[key] === undefined) toolMap[key] = block.toolUseId
        const colorIdx = sessionState.subagentColors[block.toolUseId]
        if (colorIdx !== undefined && colorMap[key] === undefined) {
          colorMap[key] = colorIdx
        }
      }
    }
    return { memberColorMap: colorMap, memberToolUseIdMap: toolMap }
  }, [sessionState])

  const loadSnapshot = useCallback(async () => {
    if (!sessionId || initialSnapshot !== undefined) return
    try {
      const res = await window.app.readSwarmBoard(sessionId)
      if (res.ok) {
        setSnapshot(res.snapshot)
        setError(null)
      } else if (res.reason === 'absent') {
        setSnapshot(null)
        setError(null)
      } else {
        setError(res.error ?? 'Failed to load swarm board')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [sessionId, initialSnapshot])

  useEffect(() => {
    if (initialSnapshot !== undefined) {
      setSnapshot(initialSnapshot)
      setLoading(false)
      return
    }
    setLoading(true)
    void loadSnapshot()
    void window.app.watchSwarmBoard(sessionId, true)
    const unsubscribe = window.app.onSwarmBoardChanged((changedId) => {
      if (changedId === sessionId) {
        void loadSnapshot()
      }
    })
    const poll = setInterval(() => {
      void loadSnapshot()
    }, 3000)
    return () => {
      unsubscribe()
      clearInterval(poll)
      void window.app.watchSwarmBoard(sessionId, false)
    }
  }, [sessionId, initialSnapshot, loadSnapshot])

  const handleSelectMemberForBoard = useCallback((memberName: string | null) => {
    setSelectedSender(memberName)
    setActiveTab('board')
  }, [])

  if (loading && !snapshot) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-xs text-warning">{error}</p>
        <button
          type="button"
          onClick={() => void loadSnapshot()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted"
        >
          <RefreshCw className="size-3" />
          Retry
        </button>
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Hexagon className="size-8 text-muted-foreground/50" />
        <div className="text-sm font-medium text-foreground">{t('swarmBoard.emptyTitle')}</div>
        <p className="max-w-xs text-xs text-muted-foreground">{t('swarmBoard.emptyHint')}</p>
      </div>
    )
  }

  const tabs: Array<{ id: SwarmTab; label: string; count?: number }> = [
    { id: 'overview', label: t('swarmBoard.tabs.overview') },
    { id: 'board', label: t('swarmBoard.tabs.board'), count: snapshot.messages.length },
    { id: 'members', label: t('swarmBoard.tabs.members'), count: snapshot.members.length },
    { id: 'graph', label: t('swarmBoard.tabs.graph') },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border/60 px-4 pt-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="truncate text-sm font-semibold text-foreground">{snapshot.title}</h1>
          <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn(
                'size-1.5 rounded-full',
                snapshot.isLive ? 'bg-emerald-500 animate-pulse' : 'bg-emerald-500/70',
              )}
            />
            <span>{snapshot.isLive ? t('swarmBoard.live') : t('swarmBoard.idle')}</span>
          </div>
        </div>

        <nav className="mt-2.5 flex items-center gap-4">
          {tabs.map((tab) => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative flex items-center gap-1.5 pb-2 text-xs font-medium transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span className="font-mono text-[11px] text-muted-foreground">{tab.count}</span>
                )}
                {active && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-foreground" />
                )}
              </button>
            )
          })}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'overview' && (
          <SwarmOverviewTab
            snapshot={snapshot}
            memberColorMap={memberColorMap}
          />
        )}
        {activeTab === 'board' && (
          <SwarmBoardMessagesTab
            snapshot={snapshot}
            memberColorMap={memberColorMap}
            selectedSender={selectedSender}
            onSelectSender={setSelectedSender}
          />
        )}
        {activeTab === 'members' && (
          <SwarmMembersTab
            snapshot={snapshot}
            memberColorMap={memberColorMap}
            memberToolUseIdMap={memberToolUseIdMap}
            onOpenMemberSubagent={(toolUseId) => {
              window.dispatchEvent(
                new CustomEvent('superone:open-subagent-full-view', {
                  detail: { sessionId, toolUseId },
                }),
              )
            }}
          />
        )}
        {activeTab === 'graph' && (
          <SwarmGraphTab snapshot={snapshot} memberColorMap={memberColorMap} />
        )}
      </div>
    </div>
  )
}
