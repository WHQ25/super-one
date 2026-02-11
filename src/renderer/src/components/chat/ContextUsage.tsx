import { useActiveSession } from '@/stores/chat'

const CONTEXT_WINDOW = 200_000

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function ContextUsage() {
  const contextTokens = useActiveSession((s) => s.contextTokens)
  const totalCostUsd = useActiveSession((s) => s.totalCostUsd)

  if (contextTokens === 0 && totalCostUsd === 0) return null

  const pct = Math.min(contextTokens / CONTEXT_WINDOW, 1)
  const radius = 5
  const circumference = 2 * Math.PI * radius
  const usedArc = circumference * pct

  // Color based on usage
  const color =
    pct > 0.7 ? '#ef4444' : pct > 0.4 ? '#f59e0b' : '#22c55e'

  return (
    <div className="group relative flex items-center">
      <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
        {/* Background ring */}
        <circle
          cx="7"
          cy="7"
          r={radius}
          fill="none"
          className="stroke-border"
          strokeWidth="2"
        />
        {/* Used arc */}
        {pct > 0 && (
          <circle
            cx="7"
            cy="7"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeDasharray={`${usedArc} ${circumference - usedArc}`}
            strokeDashoffset={circumference * 0.25}
            strokeLinecap="round"
          />
        )}
      </svg>

      {/* Hover tooltip */}
      <div className="pointer-events-none absolute bottom-full right-0 mb-2 hidden whitespace-nowrap rounded bg-muted px-2 py-1.5 text-[10px] leading-relaxed text-foreground shadow-lg group-hover:block">
        <div>Context: {formatTokens(contextTokens)} / {formatTokens(CONTEXT_WINDOW)} ({(pct * 100).toFixed(0)}%)</div>
        {totalCostUsd > 0 && <div>Cost: ${totalCostUsd.toFixed(4)}</div>}
      </div>
    </div>
  )
}
