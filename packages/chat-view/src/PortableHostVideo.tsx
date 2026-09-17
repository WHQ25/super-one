import { useEffect, useState } from 'react'
import { Loader2, Play, Video } from 'lucide-react'
import { requestNative, requestNativeAsync } from './bridge'
import { formatClockDuration } from './presenters/duration-format'

/** What the host answers a `loadVideoPoster` request with. */
export interface VideoPosterResult {
  dataUri: string
  width: number
  height: number
  durationMs?: number
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; poster: VideoPosterResult }
  /** No poster — the host could not decode the clip, or cannot answer at all; the chip remains. */
  | { kind: 'fallback' }

/**
 * Posters already fetched this session, by desktop path. Re-expanding a row or
 * scrolling back must not cost another round-trip; the phone keeps its own
 * copy too, so the two never disagree about what was paid for.
 */
const loaded = new Map<string, VideoPosterResult>()
const inflight = new Map<string, Promise<Phase>>()

function cacheKey(root: string | undefined, path: string): string {
  return root ? `${root}\u0000${path}` : path
}

function parseResult(value: unknown): Phase {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null
  const poster = record?.poster && typeof record.poster === 'object' ? record.poster as Record<string, unknown> : null
  if (
    typeof poster?.dataUri === 'string' && poster.dataUri.startsWith('data:image/')
    && typeof poster.width === 'number' && typeof poster.height === 'number'
  ) {
    return {
      kind: 'ready',
      poster: {
        dataUri: poster.dataUri,
        width: poster.width,
        height: poster.height,
        ...(typeof poster.durationMs === 'number' ? { durationMs: poster.durationMs } : {}),
      },
    }
  }
  return { kind: 'fallback' }
}

/** One request per (root, path) at a time; the answer is memoised when it carries a poster. */
function loadPoster(root: string | undefined, path: string): Promise<Phase> {
  const store = cacheKey(root, path)
  const cached = loaded.get(store)
  if (cached) return Promise.resolve({ kind: 'ready', poster: cached })
  const pending = inflight.get(store)
  if (pending) return pending
  const promise = requestNativeAsync('loadVideoPoster', { path, ...(root ? { root } : {}) })
    .then(parseResult, (): Phase => ({ kind: 'fallback' }))
    .then((phase) => {
      if (phase.kind === 'ready') loaded.set(store, phase.poster)
      inflight.delete(store)
      return phase
    })
  inflight.set(store, promise)
  return promise
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/** `0:07` / `1:02:05`, the way a player's badge reads. */
export function formatVideoDuration(durationMs: number): string {
  return formatClockDuration(durationMs)
}

/**
 * A video the desktop holds, shown in the phone's transcript as its first
 * frame with a play badge — the same tile a generated image gets, so a
 * generated clip no longer reads as a file-name chip.
 *
 * The frame is cut on the host (`loadVideoPoster`) and is tens of kilobytes,
 * so it always comes back in-band, over the relay too; the clip itself never
 * moves until the tile is tapped. That tap opens the fullscreen preview
 * through `previewFile`, which downloads the file (asking first over the
 * relay) and plays it. A host that cannot cut a frame leaves the icon chip
 * in place, so the transcript is never worse than before.
 */
export function PortableHostVideo({ path, root, label, className, tileClassName, inline = false }: {
  path: string
  /** Session root the path belongs to; folds into the poster cache key. */
  root?: string
  /** Accessible name for the tile, e.g. "Generated video". */
  label: string
  /** Applied to the chip while there is no poster; the default fits a gallery. */
  className?: string
  /** Applied to the tile once the poster is in, instead of `className`. */
  tileClassName?: string
  /**
   * Render with phrasing elements only, for a host inside a paragraph (a
   * markdown image). The default block wrappers are invalid there.
   */
  inline?: boolean
}) {
  const [phase, setPhase] = useState<Phase>(() => {
    const cached = loaded.get(cacheKey(root, path))
    return cached ? { kind: 'ready', poster: cached } : { kind: 'loading' }
  })

  useEffect(() => {
    let live = true
    const cached = loaded.get(cacheKey(root, path))
    if (cached) {
      setPhase({ kind: 'ready', poster: cached })
    } else {
      setPhase({ kind: 'loading' })
      void loadPoster(root, path).then((next) => { if (live) setPhase(next) })
    }
    return () => { live = false }
  }, [root, path])

  const open = () => requestNative('previewFile', { path, ...(root ? { root } : {}) })
  const Box = inline ? 'span' : 'div'
  const chipClass = className ?? `${inline ? 'inline-flex' : 'flex'} h-48 w-40 flex-none flex-col items-center justify-center gap-1.5 overflow-hidden rounded-md border border-border bg-muted/30 p-2 text-center`

  if (phase.kind === 'loading') {
    return (
      <Box
        className={`${chipClass} animate-pulse`}
        data-host-video="loading"
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
    const { poster } = phase
    return (
      <button
        type="button"
        className={tileClassName ?? 'relative h-48 w-auto max-w-full flex-none overflow-hidden rounded-md border border-border bg-black'}
        onClick={open}
        aria-label={`Play ${label}`}
        title={path}
        data-host-video="ready"
      >
        <img src={poster.dataUri} alt={label} width={poster.width} height={poster.height} className="block h-full w-auto max-w-full object-contain" />
        <span aria-hidden className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
            <Play className="ml-0.5 size-5 fill-current" />
          </span>
        </span>
        {poster.durationMs != null ? (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white" data-host-video-duration>
            {formatVideoDuration(poster.durationMs)}
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <button
      type="button"
      className={chipClass}
      onClick={open}
      aria-label={`Open ${label}`}
      title={path}
      data-host-video="fallback"
    >
      <Video className="size-6 text-primary" />
      <span className="max-w-full truncate text-xs text-foreground">{basename(path) || label}</span>
    </button>
  )
}
