import { lazy, Suspense, useEffect, useState } from 'react'
import { officePreviewKind, type OfficePreviewFormat } from '@superone/shared/file-preview'
import { OfficePreviewTooLargeError, readOfficePreviewBytes } from './office-preview-bytes'
import { OfficePreviewStatus } from './office-toolbar'

const OfficeDocxView = lazy(() => import('./office-docx-view').then((module) => ({ default: module.OfficeDocxView })))
const OfficeXlsxView = lazy(() => import('./office-xlsx-view').then((module) => ({ default: module.OfficeXlsxView })))
const OfficePptxView = lazy(() => import('./office-pptx-view').then((module) => ({ default: module.OfficePptxView })))

export type ReadOfficePreviewBytes = (url: string, signal: AbortSignal) => Promise<ArrayBuffer>

type Ready = { phase: 'ready'; buffer: ArrayBuffer; kind: OfficePreviewFormat }
type Status = { phase: 'loading' | 'failed' | 'too-large' } | Ready

/**
 * Preview of a `.docx`, `.xlsx` or `.pptx`. The viewers stay read-only.
 * Excel can still resize columns and rows. PowerPoint in the full preview
 * shows the thumbnail rail. The engines load only after the bytes are in
 * hand and under the size cap, so a rejected fetch never pulls WASM into the page.
 */
export function OfficePreview({
  url,
  name,
  variant = 'full',
  readBytes = readOfficePreviewBytes,
  className,
}: {
  url: string
  name: string
  /** `stage` hides the PowerPoint thumbnail rail. */
  variant?: 'full' | 'stage'
  readBytes?: ReadOfficePreviewBytes
  className?: string
}) {
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<Status>({ phase: 'loading' })
  const chrome = variant === 'full'

  useEffect(() => {
    const ac = new AbortController()
    setStatus({ phase: 'loading' })
    void readBytes(url, ac.signal).then((buffer) => {
      if (ac.signal.aborted) return
      const kind = officePreviewKind(name)
      if (!kind) { setStatus({ phase: 'failed' }); return }
      setStatus({ phase: 'ready', buffer, kind })
    }).catch((err: unknown) => {
      if (ac.signal.aborted) return
      setStatus(err instanceof OfficePreviewTooLargeError ? { phase: 'too-large' } : { phase: 'failed' })
    })
    return () => ac.abort()
  }, [url, name, attempt, readBytes])

  return (
    <div className={className ? `flex h-full min-h-0 flex-col ${className}` : 'flex h-full min-h-0 flex-col'}>
      {status.phase === 'ready' ? (
        <Suspense fallback={<OfficePreviewStatus phase="loading" />}>
          {status.kind === 'docx' && <OfficeDocxView buffer={status.buffer} fileName={name} />}
          {status.kind === 'xlsx' && <OfficeXlsxView buffer={status.buffer} fileName={name} />}
          {status.kind === 'pptx' && <OfficePptxView buffer={status.buffer} chrome={chrome} />}
        </Suspense>
      ) : (
        <OfficePreviewStatus
          phase={status.phase}
          onRetry={status.phase === 'failed' ? () => setAttempt((n) => n + 1) : undefined}
        />
      )}
    </div>
  )
}
