import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { useChatStore, useActiveSession, useSessionScope, selectClaudeModels } from '@/stores/chat'
import { resolveModelContextWindow } from '@superone/shared/agent-types'

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function ContextUsage() {
  const scope = useSessionScope()
  const contextTokens = useActiveSession((s) => s.contextTokens)
  const contextWindowFromSession = useActiveSession((s) => s.contextWindow)
  const selectedModel = useActiveSession((s) => s.selectedModel)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const totalCostUsd = useActiveSession((s) => s.totalCostUsd)
  const status = useActiveSession((s) => s.status)
  const detailedUsage = useActiveSession((s) => s.detailedUsage)
  const activeSessionId = useActiveSession((s) => scope?.sessionId ?? s._activeSessionId)
  const availableModels = useChatStore(selectClaudeModels)
  const activeProject = useChatStore((s) => s.activeProject)
  const setDetailedUsage = useChatStore((s) => s.setDetailedUsage)

  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const prevStatusRef = useRef(status)
  const prevSessionRef = useRef<{ sid: string | null; model: string }>({ sid: activeSessionId ?? null, model: selectedModel })

  useEffect(() => {
    const prev = prevSessionRef.current
    const sidChanged = prev.sid !== activeSessionId
    const modelChanged = prev.model !== selectedModel
    prevSessionRef.current = { sid: activeSessionId ?? null, model: selectedModel }
    if (sidChanged || !modelChanged) return
    if (!activeProject || !activeSessionId) return
    setDetailedUsage(activeProject, activeSessionId, null)
  }, [selectedModel, activeProject, activeSessionId, setDetailedUsage])

  useEffect(() => {
    const wasStreaming = prevStatusRef.current === 'streaming'
    prevStatusRef.current = status
    if (!wasStreaming || status !== 'idle' || !activeProject || !activeSessionId) return
    if (sessionProvider && sessionProvider !== 'claude' && sessionProvider !== 'opencode') return
    const sid = activeSessionId
    const project = activeProject
    window.agent.getContextUsage(project, sid).then((usage) => {
      if (!usage) return
      setDetailedUsage(project, sid, usage)
    }).catch(() => {})
  }, [status, activeProject, activeSessionId, sessionProvider, setDetailedUsage])

  const activeProvider = sessionProvider ?? preferredProvider
  const currentModel = availableModels.find((m) => m.id === selectedModel)
  const effectiveTokens = detailedUsage?.totalTokens ?? contextTokens
  const contextWindow =
    detailedUsage?.maxTokens ??
    (contextWindowFromSession && contextWindowFromSession > 0
      ? contextWindowFromSession
      : activeProvider === 'claude'
        ? resolveModelContextWindow({ id: selectedModel, resolvedModel: currentModel?.resolvedModel })
        : null)
  const pct = contextWindow ? Math.min(effectiveTokens / contextWindow, 1) : 0
  const exceeded = contextWindow ? effectiveTokens > contextWindow : false
  const radius = 5
  const circumference = 2 * Math.PI * radius
  const usedArc = circumference * pct

  const popoverRef = useRef<HTMLDivElement>(null)

  const toggleOpen = useCallback(() => {
    setOpen((v) => {
      if (v) setExpanded(false)
      return !v
    })
  }, [])

  const toggleExpanded = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setExpanded((v) => !v)
  }, [])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
        setExpanded(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (effectiveTokens === 0 && totalCostUsd === 0) return null

  const color = exceeded || pct > 0.7 ? '#ef4444' : pct > 0.4 ? '#f59e0b' : '#22c55e'
  const hasDetails = detailedUsage && detailedUsage.categories.length > 0

  return (
    <div className="relative flex items-center" ref={popoverRef}>
      <IconButton size="sm" onClick={toggleOpen} className="rounded-sm">
        <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
          <circle cx="7" cy="7" r={radius} fill="none" className="stroke-border" strokeWidth="2" />
          {pct > 0 && (
            <circle
              cx="7" cy="7" r={radius} fill="none" stroke={color} strokeWidth="2"
              strokeDasharray={`${usedArc} ${circumference - usedArc}`}
              strokeDashoffset={circumference * 0.25} strokeLinecap="round"
            />
          )}
        </svg>
      </IconButton>

      {open && (
        <div className="absolute bottom-full right-0 z-50 pb-2">
          <div className="whitespace-nowrap rounded-lg bg-popover px-2.5 py-2 text-xs leading-relaxed text-popover-foreground shadow-lg ring-1 ring-border">
            <div>
              Context: {formatTokens(effectiveTokens)}
              {contextWindow ? ` / ${formatTokens(contextWindow)} (${(pct * 100).toFixed(0)}%)` : ''}
            </div>
            {exceeded && <div className="text-red-500">Exceeds current model limit</div>}
            <div className="mt-0.5 flex items-center gap-2">
              {totalCostUsd > 0 && (
                <span className="text-muted-foreground">Cost: ${totalCostUsd.toFixed(4)}</span>
              )}
              {hasDetails && (
                <button
                  onClick={toggleExpanded}
                  className="ml-auto flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
                >
                  <span>{expanded ? 'Hide' : 'Details'}</span>
                  {expanded ? <ChevronDown className="size-2.5" /> : <ChevronUp className="size-2.5" />}
                </button>
              )}
            </div>
            {expanded && hasDetails && (
              <div className="mt-1 max-h-48 space-y-0.5 overflow-y-auto border-t border-border pt-1">
                {detailedUsage.categories.filter((c) => c.tokens > 0).map((c) => (
                  <div key={c.name} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{c.name}</span>
                    <span>{formatTokens(c.tokens)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
