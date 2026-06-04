import { useCallback, useEffect, useRef, useState } from 'react'
import { Gauge } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { cn } from '@superone/ui/lib/utils'
import { useActiveSession, useChatStore } from '@/stores/chat'
import type { CodexRateLimits, CodexRateLimitWindow } from '@superone/shared/agent-types'

function formatWindowLabel(minutes: number | null): string {
  if (!minutes || minutes <= 0) return 'Usage'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

function formatResetIn(resetsAtSeconds: number | null): string | null {
  if (!resetsAtSeconds) return null
  const diffMs = resetsAtSeconds * 1000 - Date.now()
  if (diffMs <= 0) return 'resets soon'
  const totalMin = Math.round(diffMs / 60_000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  if (days > 0) return `resets in ${days}d ${hours}h`
  if (hours > 0) return `resets in ${hours}h ${mins}m`
  return `resets in ${mins}m`
}

function usedColor(percent: number): string {
  if (percent >= 90) return 'bg-red-500'
  if (percent >= 70) return 'bg-amber-500'
  return 'bg-green-500'
}

function remainingColor(percent: number): string {
  if (percent <= 10) return 'bg-red-500'
  if (percent <= 30) return 'bg-amber-500'
  return 'bg-green-500'
}

function WindowRow({ label, window }: { label: string; window: CodexRateLimitWindow }) {
  const remaining = Math.max(0, Math.min(100, 100 - window.usedPercent))
  const resetIn = formatResetIn(window.resetsAt)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="opacity-70">{label}</span>
        <span className="flex items-center gap-1.5">
          <span className="font-medium tabular-nums">{Math.round(remaining)}% left</span>
          {resetIn && <span className="opacity-50">· {resetIn}</span>}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-border/60">
        <div className={cn('h-full rounded-full transition-all', remainingColor(remaining))} style={{ width: `${remaining}%` }} />
      </div>
    </div>
  )
}

function CodexRateLimitIcon({ projectPath, apiProviderId, status }: { projectPath: string; apiProviderId: string | null; status: string }) {
  const [limits, setLimits] = useState<CodexRateLimits | null>(null)
  const prevStatusRef = useRef(status)

  const fetchLimits = useCallback(() => {
    window.app.codexGetRateLimits(projectPath, apiProviderId).then(setLimits).catch(() => {})
  }, [projectPath, apiProviderId])

  useEffect(() => {
    setLimits(null)
    fetchLimits()
  }, [fetchLimits])

  useEffect(() => {
    const wasStreaming = prevStatusRef.current === 'streaming'
    prevStatusRef.current = status
    if (wasStreaming && status === 'idle') fetchLimits()
  }, [status, fetchLimits])

  if (!limits || (!limits.primary && !limits.secondary)) return null

  const windows = [limits.primary, limits.secondary].filter((w): w is CodexRateLimitWindow => Boolean(w))
  const maxPercent = Math.max(...windows.map((w) => w.usedPercent))

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="relative rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
            <Gauge className="size-3.5" />
            <span className={cn('absolute top-1 right-1 size-1.5 rounded-full', usedColor(maxPercent))} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <div className="flex min-w-52 flex-col gap-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">Codex Usage</span>
              {limits.planType && <span className="opacity-50">{limits.planType}</span>}
            </div>
            {limits.primary && <WindowRow label={formatWindowLabel(limits.primary.windowDurationMins)} window={limits.primary} />}
            {limits.secondary && <WindowRow label={formatWindowLabel(limits.secondary.windowDurationMins)} window={limits.secondary} />}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function UsageStatusIcon() {
  const activeProject = useChatStore((s) => s.activeProject)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const apiProviderId = useActiveSession((s) => s.apiProviderId)
  const status = useActiveSession((s) => s.status)
  const activeProvider = sessionProvider ?? preferredProvider

  if (!activeProject || activeProvider !== 'codex') return null

  return <CodexRateLimitIcon projectPath={activeProject} apiProviderId={apiProviderId ?? null} status={status} />
}
