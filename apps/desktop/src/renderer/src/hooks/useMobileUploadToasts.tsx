import { useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Smartphone, FileUp, Check, AlertCircle } from 'lucide-react'
import type { MobileUploadProgress } from '@superone/shared/agent-types'

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function basename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '')
  return trimmed.split(/[/\\]/).pop() || trimmed
}

function UploadToast({ p, t }: { p: MobileUploadProgress; t: (key: string, opts?: Record<string, unknown>) => string }): React.JSX.Element {
  const pct = p.size > 0 ? Math.min(100, Math.round((p.receivedBytes / p.size) * 100)) : 0
  const device = p.deviceName || t('sidebar.remote.disconnected')
  const dir = basename(p.targetDir)

  const statusLabel =
    p.status === 'completed'
      ? t('sidebar.remote.upload.completed')
      : p.status === 'failed'
        ? t('sidebar.remote.upload.failed')
        : t('sidebar.remote.upload.receiving')

  const Icon = p.status === 'completed' ? Check : p.status === 'failed' ? AlertCircle : FileUp
  const iconColor =
    p.status === 'completed' ? 'text-success' : p.status === 'failed' ? 'text-destructive' : 'text-primary'

  return (
    <div className="flex w-[356px] items-start gap-3 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
      <div className={`mt-0.5 shrink-0 ${iconColor}`}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Smartphone className="size-3 shrink-0" />
          <span className="truncate">{t('sidebar.remote.upload.route', { device, dir })}</span>
        </div>
        <div className="mt-0.5 truncate text-sm font-medium" title={p.fileName}>
          {p.fileName}
        </div>
        {p.status === 'failed' ? (
          <div className="mt-1 truncate text-xs text-destructive" title={p.error}>
            {statusLabel}
          </div>
        ) : (
          <>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-[width] duration-200 ${p.status === 'completed' ? 'bg-success' : 'bg-primary'}`}
                style={{ width: `${p.status === 'completed' ? 100 : pct}%` }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{statusLabel}</span>
              <span>
                {p.status === 'completed'
                  ? formatBytes(p.size || p.receivedBytes)
                  : p.size > 0
                    ? `${formatBytes(p.receivedBytes)} / ${formatBytes(p.size)}`
                    : formatBytes(p.receivedBytes)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function useMobileUploadToasts(): void {
  const { t } = useTranslation()

  useEffect(() => {
    return window.app.onUploadProgress((p) => {
      toast.custom(() => <UploadToast p={p} t={t} />, {
        id: `mobile-upload-${p.requestId}`,
        duration: p.status === 'receiving' ? Infinity : p.status === 'failed' ? 6000 : 4000,
        position: 'top-center',
      })
    })
  }, [t])
}
