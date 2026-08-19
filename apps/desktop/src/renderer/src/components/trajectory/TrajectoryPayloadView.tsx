import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import type { TrajectoryImageRef, TrajectoryPayload } from '@superone/shared/trajectory-types'

/**
 * A payload pane: the exact text, and a way to the rest of it.
 *
 * The projection bounds what it ships so one `Read` of a large file cannot
 * stall the IPC channel, but a panel whose whole promise is "this is what the
 * model saw" cannot stop at the bound. The remainder is fetched only when a
 * user asks for it, from the fold that still holds it.
 */
export function Payload({
  payload,
  empty,
  sessionId,
  recordId,
  field,
  format,
}: {
  payload: TrajectoryPayload | null
  empty: string
  sessionId: string
  /** The owning record's id, or `null` for a payload the fold cannot re-serve. */
  recordId: string | null
  field: string
  /** Applied to whichever text is displayed, bounded or complete. */
  format?: (text: string) => string
}) {
  const { t } = useTranslation()
  const [full, setFull] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  // A new selection reuses this component; its predecessor's text must not
  // survive into it.
  useEffect(() => {
    setFull(null)
    setLoading(false)
    setFailed(false)
  }, [recordId, field])

  const expand = useCallback(async () => {
    if (recordId === null) return
    setLoading(true)
    const result = await window.app.readDeepseekTrajectoryPayload(sessionId, {
      kind: 'text',
      recordId,
      field,
    })
    setLoading(false)
    if (result.ok && result.kind === 'text') setFull(result.text)
    else setFailed(true)
  }, [sessionId, recordId, field])

  if (payload === null || payload.text.length === 0) {
    return <div className="p-3 text-[11px] text-muted-foreground">{empty}</div>
  }

  const text = full ?? payload.text
  const truncated = full === null && payload.truncatedChars !== undefined

  return (
    <div className="flex flex-col">
      <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5">
        {format ? format(text) : text}
      </pre>
      {truncated && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>{t('trajectory.inspector.truncated', { count: payload.truncatedChars })}</span>
          {recordId !== null && !failed && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => void expand()} disabled={loading}>
              {loading && <Loader2 className="mr-1 size-3 animate-spin" />}
              {t('trajectory.inspector.loadFull')}
            </Button>
          )}
          {failed && <span>{t('trajectory.inspector.fullUnavailable')}</span>}
        </div>
      )}
    </div>
  )
}

/**
 * One logged image, fetched from the attachment store on demand.
 *
 * dsh logs a content-addressed reference rather than bytes, so this is the only
 * place a raster is materialized — and it happens when a user opens the tab,
 * not when the session is projected.
 */
export function TrajectoryImage({
  image,
  sessionId,
}: {
  image: TrajectoryImageRef
  sessionId: string
}) {
  const { t } = useTranslation()
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setDataUrl(null)
    setFailed(false)
    void window.app.readDeepseekTrajectoryPayload(sessionId, { kind: 'image', image }).then((result) => {
      if (cancelled) return
      if (result.ok && result.kind === 'image') setDataUrl(result.dataUrl)
      else setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [sessionId, image])

  return (
    <figure className="flex flex-col gap-1">
      {dataUrl === null
        ? (
          <div className="flex h-24 items-center justify-center rounded border border-border text-[11px] text-muted-foreground">
            {failed ? t('trajectory.inspector.imageUnavailable') : <Loader2 className="size-4 animate-spin" />}
          </div>
        )
        : <img src={dataUrl} alt={image.name ?? ''} className="max-w-full rounded border border-border" />}
      <figcaption className="font-mono text-[10px] text-muted-foreground">
        {image.name ?? image.mediaType} · {image.width}×{image.height} · {Math.round(image.bytes / 1024)} KB
      </figcaption>
    </figure>
  )
}

/** A label/value grid for the metric panes. */
export function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <table className="w-full py-2 text-[11px]">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td className="w-36 py-0.5 pl-3 pr-2 text-muted-foreground">{label}</td>
            <td className="py-0.5 pr-3 font-mono">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
