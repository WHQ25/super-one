import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

interface CloneDestinationLineProps {
  path: string
  cloning: boolean
  /** Download percent; null while git has not reported one (always for remote hosts). */
  progress: number | null
  warning?: string
}

/** "Clones into" preview in the repository card; becomes a progress bar while cloning. */
export function CloneDestinationLine({
  path,
  cloning,
  progress,
  warning,
}: CloneDestinationLineProps) {
  const { t } = useTranslation()
  return (
    <div className="pt-1">
      <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {t(cloning ? 'sidebar.addProject.cloningInto' : 'sidebar.addProject.clonesInto', {
            path,
          })}
        </span>
        {cloning && progress !== null && (
          <span className="shrink-0 tabular-nums">{progress}%</span>
        )}
      </div>
      {cloning && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress ?? undefined}
          className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          {progress === null ? (
            <div className="browser-progress-bar h-full w-1/4 rounded-full bg-primary" />
          ) : (
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          )}
        </div>
      )}
      {!cloning && warning && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="min-w-0 leading-snug">{warning}</span>
        </div>
      )}
    </div>
  )
}
