import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Gauge } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { useActiveSession, useChatStore } from '@/stores/chat'
import type { ClaudeExtraUsage, ClaudeRateLimits, CodexAccountUsage, CodexRateLimits, CodexRateLimitWindow } from '@superone/shared/agent-types'

function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

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

function WindowRow({ label, usedPercent, resetsAt }: { label: string; usedPercent: number; resetsAt: number | null }) {
  const remaining = Math.max(0, Math.min(100, 100 - usedPercent))
  const resetIn = formatResetIn(resetsAt)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="opacity-70">{label}</span>
        <span className="flex items-center gap-1.5">
          {resetIn && <span className="opacity-50">{resetIn} ·</span>}
          <span className="font-medium tabular-nums">{Math.round(remaining)}% left</span>
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-border/60">
        <div className={cn('h-full rounded-full transition-all', remainingColor(remaining))} style={{ width: `${remaining}%` }} />
      </div>
    </div>
  )
}

function ExtraUsageRow({ extra }: { extra: ClaudeExtraUsage }) {
  const value = extra.limitDollars != null
    ? `$${extra.usedDollars.toFixed(2)} / $${extra.limitDollars.toFixed(2)}`
    : `$${extra.usedDollars.toFixed(2)}`
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="opacity-70">Extra usage</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="opacity-70">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

function AccountUsageSection({ usage }: { usage: CodexAccountUsage }) {
  const rows: ReactNode[] = []
  if (usage.lifetimeTokens != null) rows.push(<StatRow key="lifetime" label="Lifetime tokens" value={formatTokens(usage.lifetimeTokens)} />)
  if (usage.peakDailyTokens != null) rows.push(<StatRow key="peak" label="Peak daily" value={formatTokens(usage.peakDailyTokens)} />)
  if (usage.currentStreakDays != null) rows.push(<StatRow key="streak" label="Streak" value={`${usage.currentStreakDays}d`} />)
  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-1 border-t border-border/60 pt-2">{rows}</div>
  )
}

function RateLimitGauge({ title, planType, maxPercent, children }: { title: string; planType: string | null; maxPercent: number; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton size="sm" className="relative">
            <Gauge />
            <span className={cn('absolute top-1 right-1 size-1.5 rounded-full', usedColor(maxPercent))} />
          </IconButton>
        </TooltipTrigger>
        <TooltipContent side="top">
          <div className="flex min-w-52 flex-col gap-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{title}</span>
              {planType && <span className="opacity-50">{planType}</span>}
            </div>
            {children}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function useRefetchOnTurnEnd(status: string, fetchLimits: () => void) {
  const prevStatusRef = useRef(status)
  useEffect(() => {
    fetchLimits()
  }, [fetchLimits])
  useEffect(() => {
    const wasStreaming = prevStatusRef.current === 'streaming'
    prevStatusRef.current = status
    if (wasStreaming && status === 'idle') fetchLimits()
  }, [status, fetchLimits])
}

function CodexRateLimitIcon({ projectPath, apiProviderId, status }: { projectPath: string; apiProviderId: string | null; status: string }) {
  const [limits, setLimits] = useState<CodexRateLimits | null>(null)
  const [usage, setUsage] = useState<CodexAccountUsage | null>(null)

  const fetchLimits = useCallback(() => {
    window.app.codexGetRateLimits(projectPath, apiProviderId).then(setLimits).catch(() => {})
    window.app.codexGetAccountUsage(projectPath, apiProviderId).then(setUsage).catch(() => {})
  }, [projectPath, apiProviderId])

  useEffect(() => {
    setLimits(null)
    setUsage(null)
  }, [projectPath, apiProviderId])

  useRefetchOnTurnEnd(status, fetchLimits)

  if (!limits || (!limits.primary && !limits.secondary)) return null

  const windows = [limits.primary, limits.secondary].filter((w): w is CodexRateLimitWindow => Boolean(w))
  const maxPercent = Math.max(...windows.map((w) => w.usedPercent))

  return (
    <RateLimitGauge title="Codex Usage" planType={limits.planType} maxPercent={maxPercent}>
      {limits.primary && (
        <WindowRow label={formatWindowLabel(limits.primary.windowDurationMins)} usedPercent={limits.primary.usedPercent} resetsAt={limits.primary.resetsAt} />
      )}
      {limits.secondary && (
        <WindowRow label={formatWindowLabel(limits.secondary.windowDurationMins)} usedPercent={limits.secondary.usedPercent} resetsAt={limits.secondary.resetsAt} />
      )}
      {usage && <AccountUsageSection usage={usage} />}
    </RateLimitGauge>
  )
}

function ClaudeRateLimitIcon({ status }: { status: string }) {
  const [limits, setLimits] = useState<ClaudeRateLimits | null>(null)

  const fetchLimits = useCallback(() => {
    window.app.claudeGetRateLimits().then(setLimits).catch(() => {})
  }, [])

  useRefetchOnTurnEnd(status, fetchLimits)

  if (!limits || limits.windows.length === 0) return null

  const maxPercent = Math.max(...limits.windows.map((w) => w.usedPercent))

  return (
    <RateLimitGauge title="Claude Usage" planType={limits.planType} maxPercent={maxPercent}>
      {limits.windows.map((w) => (
        <WindowRow key={w.label} label={w.label} usedPercent={w.usedPercent} resetsAt={w.resetsAt} />
      ))}
      {limits.extraUsage && <ExtraUsageRow extra={limits.extraUsage} />}
    </RateLimitGauge>
  )
}

export function UsageStatusIcon() {
  const activeProject = useChatStore((s) => s.activeProject)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const apiProviderId = useActiveSession((s) => s.apiProviderId)
  const status = useActiveSession((s) => s.status)
  const claudeApiProvider = useChatStore((s) => s.harnessResources.claude?.account?.apiProvider)
  const activeProvider = sessionProvider ?? preferredProvider

  if (!activeProject) return null

  if (activeProvider === 'codex') {
    return <CodexRateLimitIcon projectPath={activeProject} apiProviderId={apiProviderId ?? null} status={status} />
  }

  if (activeProvider === 'claude' && claudeApiProvider === 'firstParty' && !apiProviderId) {
    return <ClaudeRateLimitIcon status={status} />
  }

  return null
}
