/**
 * Onboarding discover step: scan PATH, multi-select harnesses, enable.
 *
 * Product: Claude/Codex always SuperOne managed download (detection is advisory).
 * OpenCode / Grok enable via PATH resolve. Default selection = all detected, or
 * Claude-only when nothing found.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { useAppStore } from '@/stores/app'

type CatalogId = 'claude' | 'codex' | 'opencode' | 'acp-grok'

type ScanHit = {
  harnessId: CatalogId
  command: string | null
  detected: boolean
  version?: string
}

type ProgressState = {
  received: number
  total: number
  phase: 'download' | 'done' | 'error'
  message?: string
}

const ORDER: CatalogId[] = ['claude', 'codex', 'opencode', 'acp-grok']

function providerOf(id: CatalogId): 'claude' | 'codex' | 'opencode' | 'acp' {
  if (id === 'acp-grok') return 'acp'
  return id
}

function acpAgentOf(id: CatalogId): string | null {
  return id === 'acp-grok' ? 'grok-build' : null
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function OnboardingDiscover(): React.JSX.Element {
  const { t } = useTranslation()
  const completeOnboarding = useAppStore((s) => s.completeOnboarding)
  const [hits, setHits] = useState<ScanHit[] | null>(null)
  const [integrationLabels, setIntegrationLabels] = useState<
    Partial<Record<CatalogId, { label: string }>>
  >({})
  const [selected, setSelected] = useState<Set<CatalogId>>(new Set())
  const [scanning, setScanning] = useState(true)
  const [enabling, setEnabling] = useState(false)
  const [activeId, setActiveId] = useState<CatalogId | null>(null)
  const [progress, setProgress] = useState<Record<string, ProgressState>>({})
  const [error, setError] = useState('')

  const scan = useCallback(async () => {
    setScanning(true)
    setError('')
    try {
      const result = await window.app.scanHarnessClis()
      setHits(result.hits)
      setIntegrationLabels(result.integrationLabels ?? {})
      setSelected(new Set(result.defaultSelected))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setHits([
        { harnessId: 'claude', command: null, detected: false },
        { harnessId: 'codex', command: null, detected: false },
        { harnessId: 'opencode', command: null, detected: false },
        { harnessId: 'acp-grok', command: null, detected: false },
      ])
      setIntegrationLabels({
        claude: { label: 'Claude Agent SDK' },
        codex: { label: 'Codex App Server' },
        opencode: { label: 'OpenCode SDK' },
        'acp-grok': { label: 'Agent Client Protocol' },
      })
      setSelected(new Set(['claude']))
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    void scan()
  }, [scan])

  useEffect(() => {
    const unsub = window.app.onHarnessInstallProgress?.((event) => {
      setProgress((prev) => ({
        ...prev,
        [event.harnessId]: {
          received: event.received,
          total: event.total,
          phase: event.phase,
          message: event.message,
        },
      }))
    })
    return () => {
      unsub?.()
    }
  }, [])

  const hitById = useMemo(() => {
    const m = new Map<CatalogId, ScanHit>()
    for (const h of hits ?? []) m.set(h.harnessId, h)
    return m
  }, [hits])

  /** Only list detected CLIs; if none, offer Claude as managed-download fallback. */
  const visibleIds = useMemo((): CatalogId[] => {
    const detected = ORDER.filter((id) => hitById.get(id)?.detected)
    return detected.length > 0 ? detected : ['claude']
  }, [hitById])

  const toggle = (id: CatalogId) => {
    if (enabling) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const enableSelected = async () => {
    if (selected.size === 0 || enabling) return
    setEnabling(true)
    setError('')
    const ids = ORDER.filter((id) => selected.has(id))
    try {
      for (const id of ids) {
        setActiveId(id)
        // Product C: Claude/Codex always SuperOne-managed pin (forcePin skips PATH/bundled).
        // External harnesses: kernel resolves PATH.
        await window.app.enableHarness({
          harnessId: id,
          forcePin: id === 'claude' || id === 'codex',
        })
      }
      await completeOnboarding()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(
        t('shell.onboarding.discover.enableFailed', {
          id: activeId ?? 'harness',
          message: msg,
        }),
      )
      toast.error(msg)
    } finally {
      setActiveId(null)
      setEnabling(false)
    }
  }

  const skip = async () => {
    if (enabling) return
    await completeOnboarding()
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6">
      <div className="w-full text-center">
        <h1 className="text-2xl font-bold">{t('shell.onboarding.discover.title')}</h1>
      </div>

      {scanning ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('shell.onboarding.discover.scanning')}
        </div>
      ) : (
        <div className="flex w-full flex-col gap-2">
          {visibleIds.map((id) => {
            const hit = hitById.get(id)
            const checked = selected.has(id)
            const Icon = resolveSessionIcon(providerOf(id), acpAgentOf(id))
            const isManaged = id === 'claude' || id === 'codex'
            const isActive = activeId === id
            const isDownloadFallback = isManaged && !hit?.detected
            const integrationLabel = integrationLabels[id]?.label
            const p = progress[id]
            const pct =
              p && p.total > 0 ? Math.min(100, Math.round((p.received / p.total) * 100)) : null
            const subtitle = isDownloadFallback
              ? t('shell.onboarding.discover.willDownload')
              : hit?.version || hit?.command || null

            return (
              <button
                key={id}
                type="button"
                disabled={enabling}
                onClick={() => toggle(id)}
                className={cn(
                  'flex w-full flex-col gap-2 rounded-xl border px-4 py-3.5 text-left transition-colors',
                  checked ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:bg-muted/50',
                  enabling && 'opacity-80',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded border',
                        checked
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted-foreground/40',
                      )}
                    >
                      {checked ? <Check className="size-3.5" /> : null}
                    </span>
                    {Icon ? (
                      <Icon status="default" size={28} renderLevel="compact" />
                    ) : (
                      <span className="size-7 shrink-0 rounded bg-muted" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {t(`shell.onboarding.discover.ids.${id}`)}
                      </div>
                      {subtitle ? (
                        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {integrationLabel ? (
                      <span className="max-w-[11rem] text-right text-[10px] leading-snug text-muted-foreground">
                        {integrationLabel}
                      </span>
                    ) : null}
                    {isActive ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
                  </div>
                </div>
                {isActive && p?.phase === 'download' ? (
                  <div className="space-y-1">
                    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-200"
                        style={{ width: pct != null ? `${pct}%` : '30%' }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {p.total > 0
                        ? `${formatBytes(p.received)} / ${formatBytes(p.total)} (${pct ?? 0}%)`
                        : t('shell.onboarding.discover.enabling')}
                    </p>
                  </div>
                ) : null}
              </button>
            )
          })}
        </div>
      )}

      {error ? <p className="w-full text-center text-xs text-destructive break-words">{error}</p> : null}

      <div className="flex w-full flex-col items-center gap-3">
        <Button
          size="lg"
          className="w-full max-w-xs"
          disabled={scanning || enabling || selected.size === 0}
          onClick={() => void enableSelected()}
        >
          {enabling ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t('shell.onboarding.discover.enabling')}
            </>
          ) : (
            <>
              {t('shell.onboarding.discover.enableSelected', { count: selected.size })}
              <ArrowRight className="size-5" />
            </>
          )}
        </Button>
        <div className="flex items-center gap-4">
          <button
            type="button"
            disabled={scanning || enabling}
            onClick={() => void scan()}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('size-3.5', scanning && 'animate-spin')} />
            {t('shell.onboarding.discover.rescan')}
          </button>
          <button
            type="button"
            disabled={enabling}
            onClick={() => void skip()}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {t('shell.onboarding.discover.skip')}
          </button>
        </div>
      </div>
    </div>
  )
}
