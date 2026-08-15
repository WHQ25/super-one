import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { useChatStore, useActiveSession, useSessionScope, selectClaudeModels, selectCursorModels } from '@/stores/chat'
import { resolveRingContextWindow, type ContextUsageCategory } from '@superone/shared/agent-types'
import { resolveCursorSelectedContextWindow } from '@superone/cursor/cursor-model-selection'
import { buildCatalogModelIndex, normalizeModelId } from '@superone/shared/platform-registry'
import { useModelCatalog } from '@/hooks/useModelCatalog'
import { stripOneM } from '@/lib/model-id'
import { formatTokens } from './chat-shared'

function lookupCatalogContextWindow(
  modelIds: Array<string | null | undefined>,
  catalogModels: ReadonlyMap<string, { contextWindow?: number }>,
): number | null {
  for (const raw of modelIds) {
    if (!raw) continue
    const model = catalogModels.get(normalizeModelId(stripOneM(raw)))
    const window = model?.contextWindow
    if (typeof window === 'number' && window > 0) return window
  }
  return null
}

const RING = { size: 16, cx: 8, cy: 8, r: 6 }
const RING_CIRC = 2 * Math.PI * RING.r

function occupancyColor(pct: number, exceeded: boolean): string {
  if (exceeded || pct > 0.7) return '#ef4444'
  if (pct > 0.4) return '#f59e0b'
  return '#22c55e'
}

function UsageRing({
  hasWindow,
  occupancyPct,
  exceeded,
  segments,
}: {
  hasWindow: boolean
  occupancyPct: number
  exceeded: boolean
  segments: Array<{ tokens: number; color: string }>
}) {
  if (hasWindow) {
    const usedArc = RING_CIRC * occupancyPct
    return (
      <svg viewBox={`0 0 ${RING.size} ${RING.size}`} className="size-4 shrink-0">
        <circle
          cx={RING.cx}
          cy={RING.cy}
          r={RING.r}
          fill="none"
          className="stroke-muted-foreground/35"
          strokeWidth="2"
        />
        {occupancyPct > 0 && (
          <circle
            cx={RING.cx}
            cy={RING.cy}
            r={RING.r}
            fill="none"
            stroke={occupancyColor(occupancyPct, exceeded)}
            strokeWidth="2"
            strokeDasharray={`${usedArc} ${RING_CIRC - usedArc}`}
            strokeDashoffset={RING_CIRC * 0.25}
            strokeLinecap="round"
          />
        )}
      </svg>
    )
  }

  const total = segments.reduce((sum, s) => sum + s.tokens, 0)
  let offset = 0
  return (
    <svg viewBox={`0 0 ${RING.size} ${RING.size}`} className="size-4 shrink-0">
      <circle
        cx={RING.cx}
        cy={RING.cy}
        r={RING.r}
        fill="none"
        className="stroke-muted-foreground/35"
        strokeWidth="2"
      />
      {total > 0 && segments.map((seg) => {
        const arc = RING_CIRC * (seg.tokens / total)
        const dashOffset = RING_CIRC * 0.25 - offset
        offset += arc
        return (
          <circle
            key={`${seg.color}-${seg.tokens}`}
            cx={RING.cx}
            cy={RING.cy}
            r={RING.r}
            fill="none"
            stroke={seg.color}
            strokeWidth="2"
            strokeDasharray={`${arc} ${RING_CIRC - arc}`}
            strokeDashoffset={dashOffset}
          />
        )
      })}
    </svg>
  )
}

function categoryLabel(name: string, t: (key: string) => string): string {
  if (name === 'input') return t('settings.usage.tokenTypes.input')
  if (name === 'output') return t('settings.usage.tokenTypes.output')
  if (name === 'cacheRead') return t('settings.usage.tokenTypes.cacheRead')
  if (name === 'cacheWrite' || name === 'cacheCreation') return t('settings.usage.tokenTypes.cacheCreation')
  return name
}

export function ContextUsage() {
  const { t } = useTranslation()
  const scope = useSessionScope()
  const contextTokens = useActiveSession((s) => s.contextTokens)
  const contextWindowFromSession = useActiveSession((s) => s.contextWindow)
  const selectedModel = useActiveSession((s) => s.selectedModel)
  const cursorContextParam = useActiveSession((s) => s.cursorModelParams?.context)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const totalCostUsd = useActiveSession((s) => s.totalCostUsd)
  const status = useActiveSession((s) => s.status)
  const detailedUsage = useActiveSession((s) => s.detailedUsage)
  const activeSessionId = useActiveSession((s) => scope?.sessionId ?? s._activeSessionId)
  const availableModels = useChatStore(selectClaudeModels)
  // Must be a cached snapshot — `?? []` mints a new array when Cursor is
  // unloaded, so React 19's useSyncExternalStore treats every store tick as a
  // change and hits #185 (Maximum update depth exceeded).
  const cursorModels = useChatStore(selectCursorModels)
  const activeProject = useChatStore((s) => s.activeProject)
  const setDetailedUsage = useChatStore((s) => s.setDetailedUsage)
  const { catalog } = useModelCatalog()
  const catalogModels = useMemo(
    () => (catalog ? buildCatalogModelIndex(catalog) : new Map()),
    [catalog],
  )

  const [open, setOpen] = useState(false)
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
    // Claude / OpenCode / ACP(Grok) / Cursor expose getContextUsage; Codex uses session snapshot only.
    if (sessionProvider && sessionProvider !== 'claude' && sessionProvider !== 'opencode' && sessionProvider !== 'acp' && sessionProvider !== 'cursor') return
    const sid = activeSessionId
    const project = activeProject
    window.agent.getContextUsage(project, sid).then((usage) => {
      if (!usage) return
      setDetailedUsage(project, sid, usage)
    }).catch(() => {})
  }, [status, activeProject, activeSessionId, sessionProvider, setDetailedUsage])

  const activeProvider = sessionProvider ?? preferredProvider
  const isCursor = activeProvider === 'cursor'
  const currentModel = isCursor
    ? cursorModels.find((m) => m.id === selectedModel)
    : availableModels.find((m) => m.id === selectedModel)
  const detailedTokens = detailedUsage?.totalTokens ?? 0
  const effectiveTokens = detailedTokens > 0 ? detailedTokens : contextTokens
  const catalogContextWindow = useMemo(
    () => isCursor
      ? null
      : lookupCatalogContextWindow(
        [selectedModel, currentModel?.resolvedModel, detailedUsage?.model],
        catalogModels,
      ),
    [isCursor, selectedModel, currentModel?.resolvedModel, detailedUsage?.model, catalogModels],
  )
  // Codex GPT-5.6 uses its managed 272k window; other models prefer models.dev.
  // Cursor uses the per-turn `context` param (300k / 1m) and never models.dev.
  const contextWindow = resolveRingContextWindow({
    harnessId: activeProvider,
    modelId: selectedModel,
    resolvedModel: currentModel?.resolvedModel,
    catalogContextWindow,
    harnessContextWindow: currentModel?.contextWindow,
    sessionContextWindow: contextWindowFromSession,
    detailedMaxTokens: detailedUsage?.maxTokens,
    claudeFallback: activeProvider === 'claude',
    selectedContextWindow: isCursor
      ? resolveCursorSelectedContextWindow(cursorContextParam, currentModel)
      : null,
  })
  const hasWindow = Boolean(contextWindow)
  const occupancyPct = contextWindow ? Math.min(effectiveTokens / contextWindow, 1) : 0
  const occupancyPercent = contextWindow ? Math.round((effectiveTokens / contextWindow) * 100) : 0
  const exceeded = contextWindow ? effectiveTokens > contextWindow : false
  const categories = (detailedUsage?.categories ?? []).filter((c) => c.tokens > 0)
  const ringSegments: ContextUsageCategory[] = categories.length > 0
    ? categories
    : effectiveTokens > 0
      ? [{ name: 'tokens', tokens: effectiveTokens, color: 'var(--muted-foreground)' }]
      : []
  const categorySum = categories.reduce((sum, c) => sum + c.tokens, 0)
  const barDenom = hasWindow && !exceeded && contextWindow
    ? contextWindow
    : Math.max(categorySum, effectiveTokens, 1)
  const barSegments = (categories.length > 0 ? categories : ringSegments).map((c) => ({
    ...c,
    pct: (c.tokens / barDenom) * 100,
  }))
  const barRemaining = Math.max(0, 100 - barSegments.reduce((sum, s) => sum + s.pct, 0))

  const popoverRef = useRef<HTMLDivElement>(null)

  const toggleOpen = useCallback(() => {
    setOpen((v) => !v)
  }, [])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (effectiveTokens === 0 && totalCostUsd === 0) return null

  const usedLabel = formatTokens(effectiveTokens)
  const maxLabel = contextWindow ? formatTokens(contextWindow) : null

  return (
    <div className="relative flex items-center" ref={popoverRef}>
      <IconButton
        size="sm"
        variant="ghost"
        onClick={toggleOpen}
        className="rounded-full"
        aria-label={hasWindow
          ? t('chat.contextUsage.percent', { percent: occupancyPercent })
          : t('chat.contextUsage.tokens', { count: usedLabel })}
      >
        <UsageRing
          hasWindow={hasWindow}
          occupancyPct={occupancyPct}
          exceeded={exceeded}
          segments={ringSegments}
        />
      </IconButton>

      {open && (
        <div className="absolute bottom-full right-0 z-50 pb-2">
          <div className="flex w-52 flex-col gap-2 rounded-lg bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-border">
            {hasWindow ? (
              <div className="flex flex-col gap-0.5">
                <div className={cn('text-base font-medium tabular-nums', exceeded && 'text-destructive')}>
                  {t('chat.contextUsage.percent', { percent: occupancyPercent })}
                </div>
                <div className="tabular-nums text-muted-foreground">
                  {t('chat.contextUsage.usedOfMax', { used: usedLabel, max: maxLabel })}
                </div>
              </div>
            ) : (
              <div className="text-sm font-medium tabular-nums">
                {t('chat.contextUsage.tokens', { count: usedLabel })}
              </div>
            )}
            {exceeded && <div className="text-destructive">{t('chat.contextUsage.exceeds')}</div>}
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
              {barSegments.map((s) => (
                <div
                  key={s.name}
                  className="h-full shrink-0"
                  style={{ width: `${s.pct}%`, backgroundColor: s.color }}
                />
              ))}
              {barRemaining > 0 && (
                <div className="h-full min-w-0 flex-1" />
              )}
            </div>
            {categories.length > 0 && (
              <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {categories.map((c) => (
                  <div key={c.name} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                      <span className="truncate">{categoryLabel(c.name, t)}</span>
                    </span>
                    <span className="tabular-nums">{formatTokens(c.tokens)}</span>
                  </div>
                ))}
                {hasWindow && barRemaining > 0 && (
                  <div className="flex items-center justify-between gap-3 text-muted-foreground">
                    <span>{t('chat.contextUsage.free')}</span>
                    <span className="tabular-nums">{formatTokens(Math.max(0, (contextWindow ?? 0) - effectiveTokens))}</span>
                  </div>
                )}
              </div>
            )}
            {totalCostUsd > 0 && (
              <div className="text-muted-foreground">
                {t('chat.contextUsage.cost', { amount: totalCostUsd.toFixed(4) })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
