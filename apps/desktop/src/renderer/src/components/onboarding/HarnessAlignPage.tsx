/**
 * Blocking startup gate: download pin-aligned managed runtimes for enabled
 * Claude/Codex before entering main UI.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import logoUrl from '@/assets/logo-text-inline.png'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { useAppStore } from '@/stores/app'

export type HarnessAlignProgress = {
  harnessId: string
  received: number
  total: number
  phase: 'download' | 'done' | 'error'
  message?: string
}

export type HarnessAlignViewProps = {
  busy: boolean
  error: string
  progress: HarnessAlignProgress | null
  onRetry?: () => void
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Presentational gate UI — drive via props for Storybook / design iteration. */
export function HarnessAlignView({
  busy,
  error,
  progress,
  onRetry,
}: HarnessAlignViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const downloading = progress?.phase === 'download'
  const HarnessIcon = downloading ? resolveSessionIcon(progress.harnessId) : null

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
      <img src={logoUrl} alt="Super One" draggable={false} className="h-10 w-auto select-none" />
      <div className="w-full max-w-sm text-center">
        <h1 className="text-xl font-semibold">{t('shell.harnessAlign.title')}</h1>
      </div>

      {busy ? (
        <div className="flex w-full max-w-sm flex-col items-center gap-3">
          {downloading ? (
            <>
              {HarnessIcon ? (
                <HarnessIcon status="default" size={28} renderLevel="compact" />
              ) : (
                <Loader2 className="size-5 animate-spin text-primary" />
              )}
              <div className="w-full space-y-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-200"
                    style={{ width: pct != null ? `${pct}%` : '30%' }}
                  />
                </div>
                {progress.total > 0 ? (
                  <p className="text-center text-[11px] text-muted-foreground tabular-nums">
                    {formatBytes(progress.received)} / {formatBytes(progress.total)} ({pct ?? 0}%)
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <Loader2 className="size-5 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">{t('shell.harnessAlign.checking')}</p>
            </>
          )}
        </div>
      ) : null}

      {error ? (
        <div className="flex w-full max-w-sm flex-col items-center gap-3">
          <p className="whitespace-pre-wrap text-center text-xs text-destructive break-words">{error}</p>
          {onRetry ? (
            <Button size="sm" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function HarnessAlignPage(): React.JSX.Element {
  const { t } = useTranslation()
  const finishHarnessAlign = useAppStore((s) => s.finishHarnessAlign)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<HarnessAlignProgress | null>(null)
  const [busy, setBusy] = useState(true)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    const unsub = window.app.onHarnessInstallProgress?.((event) => {
      setProgress({
        harnessId: event.harnessId,
        received: event.received,
        total: event.total,
        phase: event.phase,
        message: event.message,
      })
    })
    return () => {
      unsub?.()
    }
  }, [])

  const runAlign = useCallback(async () => {
    setBusy(true)
    setError('')
    setProgress(null)
    try {
      const result = await window.app.alignEnabledHarnesses()
      if (!aliveRef.current) return
      if (result.failed.length > 0) {
        setError(
          result.failed.map((f) => `${f.id}: ${f.error}`).join('\n') ||
            t('shell.harnessAlign.failed'),
        )
        setBusy(false)
        return
      }
      await finishHarnessAlign()
    } catch (err) {
      if (!aliveRef.current) return
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }, [finishHarnessAlign, t])

  useEffect(() => {
    void runAlign()
  }, [runAlign])

  return (
    <HarnessAlignView
      busy={busy}
      error={error}
      progress={progress}
      onRetry={() => {
        void runAlign()
      }}
    />
  )
}
