import type { ReactNode } from 'react'
import { ImageIcon } from 'lucide-react'

export interface ToolScreenshotViewPresenterProps {
  path: string
  label: string
  unavailableLabel: string
  unavailable?: boolean
  loading?: boolean
  onPreview?: (path: string) => void
  thumbnail?: ReactNode
  overlay?: ReactNode
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/** Shared screenshot state and portable preview affordance; hosts own image loading. */
export function ToolScreenshotViewPresenter({
  path,
  label,
  unavailableLabel,
  unavailable = false,
  loading = false,
  onPreview,
  thumbnail,
  overlay,
}: ToolScreenshotViewPresenterProps) {
  if (unavailable) {
    return <div className="text-xs italic text-muted-foreground/60">{unavailableLabel}</div>
  }
  if (loading) return null

  return (
    <>
      {thumbnail ?? (
        <button
          type="button"
          className="flex min-h-24 w-full items-center justify-center rounded border border-border/60 bg-muted/25 text-primary"
          onClick={onPreview ? () => onPreview(path) : undefined}
          disabled={!onPreview}
          aria-label={`Preview ${label}`}
          title={path}
        >
          <ImageIcon className="mr-1.5 size-4" />
          <span className="max-w-64 truncate">{basename(path) || label}</span>
        </button>
      )}
      {overlay}
    </>
  )
}
