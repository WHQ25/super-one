import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import type { RunningHarnessCount } from '@/lib/multi-host/running-sessions'

/** In-progress sessions on one line: a running harness icon and its count. */
export function RunningHarnessLine({
  counts,
  slot = 'project-running',
}: {
  counts: readonly RunningHarnessCount[]
  slot?: string
}) {
  if (counts.length === 0) return null
  return (
    <div data-slot={slot} className="flex items-center gap-3 text-muted-foreground">
      {counts.map((row) => {
        const Icon = resolveSessionIcon(row.provider, row.acpAgentId)
        return (
          <span key={`${row.provider}:${row.acpAgentId ?? ''}`} className="inline-flex items-center gap-1">
            {Icon ? <Icon status="running" renderLevel="compact" size={14} /> : null}
            <span className="tabular-nums">{row.count}</span>
          </span>
        )
      })}
    </div>
  )
}
