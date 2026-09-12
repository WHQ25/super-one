import { useEffect, useState, type ReactNode } from 'react'
import type { ImageGenerationInfo } from '@superone/shared/agent-types'
import { Download, ImageIcon, Loader2 } from 'lucide-react'
import { requestNative, requestNativeAsync } from './bridge'
import { previewImage } from './image-preview'

/** What the host answers a `loadImage` request with. */
export type LoadImageResult =
  /** The bytes, ready for an `<img src>`. */
  | { dataUri: string }
  /** The host will not fetch over this transport until the user asks; `size` is for the prompt. */
  | { confirmRequired: true; size?: number }

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; dataUri: string }
  | { kind: 'confirm'; size?: number }
  /** Any failure, including a host without `loadImage`; the preview chip remains. */
  | { kind: 'fallback' }

/**
 * Bytes already fetched this session, by desktop path. Re-expanding a tool row
 * or scrolling back must not cost another transfer, and the phone keeps its
 * own copy so the two never disagree about what was paid for.
 */
const loaded = new Map<string, string>()
const inflight = new Map<string, Promise<Phase>>()

function parseResult(value: unknown): Phase {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null
  if (typeof record?.dataUri === 'string' && record.dataUri.startsWith('data:image/')) {
    return { kind: 'ready', dataUri: record.dataUri }
  }
  if (record?.confirmRequired === true) {
    return { kind: 'confirm', ...(typeof record.size === 'number' ? { size: record.size } : {}) }
  }
  return { kind: 'fallback' }
}

/** One request per path at a time; the answer is memoised when it carries bytes. */
function loadImage(path: string, confirmed: boolean): Promise<Phase> {
  const cached = loaded.get(path)
  if (cached) return Promise.resolve({ kind: 'ready', dataUri: cached })
  const key = `${confirmed ? 'c' : 'p'}:${path}`
  const pending = inflight.get(key)
  if (pending) return pending
  const promise = requestNativeAsync('loadImage', { path, ...(confirmed ? { confirmed: true } : {}) })
    .then(parseResult, (): Phase => ({ kind: 'fallback' }))
    .then((phase) => {
      if (phase.kind === 'ready') loaded.set(path, phase.dataUri)
      inflight.delete(key)
      return phase
    })
  inflight.set(key, promise)
  return promise
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * An image the desktop holds, shown inline in the phone's transcript.
 *
 * Desktop tool rows read screenshots and generated images straight off disk;
 * the phone has to ask for them. Over the LAN the host answers with the bytes
 * and the picture simply appears. Over the relay a small file comes back the
 * same way (in-band on the RPC). A larger file would be staged encrypted on
 * the relay first, so the host answers `confirmRequired` — the row then shows
 * a Load button and the user decides.
 * A host that cannot answer at all leaves the plain preview chip in place, so
 * the transcript is never worse than before.
 *
 * Tapping the picture opens the bytes already on the phone in the fullscreen
 * viewer (`previewImage`); only the chip without a picture yet still goes
 * through `previewFile`, because there is nothing to show until the file lands.
 */
export function PortableHostImage({ path, label, className, pictureClassName, imageClassName, fallback, caption, generation, inline = false }: {
  path: string
  /** Accessible name for the preview affordance, e.g. "Screenshot". */
  label: string
  /** Applied to the chip/picture button; the default fits a tool row. */
  className?: string
  /** Applied to the picture button once the bytes are in, instead of `className`. */
  pictureClassName?: string
  /** Applied to the `<img>` itself; the default fits a tool row. */
  imageClassName?: string
  /** Chip content while there is no picture yet; defaults to an icon and the file name. */
  fallback?: ReactNode
  /** Shown under the picture once it has loaded. */
  caption?: ReactNode
  /** For a generated image: what the viewer's info panel shows. */
  generation?: ImageGenerationInfo
  /**
   * Render with phrasing elements only, for a host inside a paragraph (a
   * markdown image). The default block wrappers are invalid there.
   */
  inline?: boolean
}) {
  const [phase, setPhase] = useState<Phase>(() => {
    const cached = loaded.get(path)
    return cached ? { kind: 'ready', dataUri: cached } : { kind: 'loading' }
  })

  useEffect(() => {
    let live = true
    const cached = loaded.get(path)
    if (cached) {
      setPhase({ kind: 'ready', dataUri: cached })
    } else {
      setPhase({ kind: 'loading' })
      void loadImage(path, false).then((next) => { if (live) setPhase(next) })
    }
    return () => { live = false }
  }, [path])

  const confirm = () => {
    setPhase({ kind: 'loading' })
    void loadImage(path, true).then(setPhase)
  }

  const Box = inline ? 'span' : 'div'
  const chipClass = className ?? `${inline ? 'inline-flex' : 'flex'} min-h-24 w-full items-center justify-center rounded border border-border/60 bg-muted/25 text-primary`
  // A custom chip names itself through its content; the default chip is icon-only.
  const ariaLabel = fallback ? undefined : `Preview ${label}`

  // The row fetches on its own, so while it is fetching it says so. It used to
  // show the file-name chip here, which is the *fallback* affordance — a row
  // that was about to paint a picture looked exactly like one that never would,
  // and the picture then replaced a name the reader had started to read.
  if (phase.kind === 'loading') {
    return (
      <Box
        className={`${chipClass} animate-pulse`}
        data-host-image="loading"
        role="status"
        aria-busy="true"
        aria-label={`Loading ${label}`}
        title={path}
      >
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
      </Box>
    )
  }

  if (phase.kind === 'ready') {
    return (
      <button
        type="button"
        className={pictureClassName ?? className ?? 'block w-full overflow-hidden rounded border border-border/60 bg-muted/25'}
        onClick={() => previewImage(phase.dataUri, { label, path, generation })}
        aria-label={ariaLabel}
        title={path}
        data-host-image="ready"
      >
        <img src={phase.dataUri} alt={label} className={imageClassName ?? 'mx-auto max-h-72 w-auto max-w-full object-contain'} />
        {caption}
      </button>
    )
  }

  return (
    <Box className={`${inline ? 'inline-flex' : 'flex'} flex-col gap-1.5`} data-host-image={phase.kind}>
      <button
        type="button"
        className={chipClass}
        onClick={() => requestNative('previewFile', { path })}
        aria-label={ariaLabel}
        title={path}
      >
        {fallback ?? (
          <>
            <ImageIcon className="mr-1.5 size-4" />
            <span className="max-w-64 truncate">{basename(path) || label}</span>
          </>
        )}
      </button>
      {phase.kind === 'confirm' ? (
        <button
          type="button"
          className="inline-flex items-center justify-center gap-1.5 self-center rounded border border-border/60 bg-background px-2.5 py-1 text-xs text-primary"
          onClick={confirm}
          aria-label={`Load ${label}`}
        >
          <Download className="size-3.5" />
          Load image{phase.size != null ? ` · ${formatSize(phase.size)}` : ''}
        </button>
      ) : null}
    </Box>
  )
}
