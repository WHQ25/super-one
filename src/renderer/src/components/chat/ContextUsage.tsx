import { useChatStore, useActiveSession } from '@/stores/chat'
import { DEFAULT_CONTEXT_WINDOW } from '../../../../shared/agent-types'

const EXTENDED_CONTEXT_WINDOW = 1_000_000

function resolveContextWindow(modelName: string): number {
  return /\b1[Mm]\b/.test(modelName) ? EXTENDED_CONTEXT_WINDOW : DEFAULT_CONTEXT_WINDOW
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function ContextUsage() {
  const contextTokens = useActiveSession((s) => s.contextTokens)
  const selectedModel = useActiveSession((s) => s.selectedModel)
  const totalCostUsd = useActiveSession((s) => s.totalCostUsd)
  const availableModels = useChatStore((s) => s.availableModels)

  const currentModel = availableModels.find((m) => m.id === selectedModel)
  const modelName = currentModel?.name ?? currentModel?.description ?? ''
  const contextWindow = resolveContextWindow(modelName)
  const pct = Math.min(contextTokens / contextWindow, 1)
  const exceeded = contextTokens > contextWindow
  const radius = 5
  const circumference = 2 * Math.PI * radius
  const usedArc = circumference * pct

  if (contextTokens === 0 && totalCostUsd === 0) return null

  const color = exceeded || pct > 0.7 ? '#ef4444' : pct > 0.4 ? '#f59e0b' : '#22c55e'

  return (
    <div className="group relative flex items-center">
      <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
        <circle
          cx="7"
          cy="7"
          r={radius}
          fill="none"
          className="stroke-border"
          strokeWidth="2"
        />
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

      <div className="pointer-events-none absolute bottom-full right-0 mb-2 hidden whitespace-nowrap rounded bg-muted px-2 py-1.5 text-[10px] leading-relaxed text-foreground shadow-lg group-hover:block">
        <div>Context: {formatTokens(contextTokens)} / {formatTokens(contextWindow)} ({(pct * 100).toFixed(0)}%)</div>
        {exceeded && <div className="text-red-500">Exceeds current model limit</div>}
        {totalCostUsd > 0 && <div>Cost: ${totalCostUsd.toFixed(4)}</div>}
      </div>
    </div>
  )
}
