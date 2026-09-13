import type { ReadVideoPosterResponse, RemoteCommand } from '@superone/shared/agent-types'
import { resolveRemoteFilePath } from './shell-state'
import { randomId } from './ids'

/** The answer the chat WebView's `PortableHostVideo` paints. */
export interface VideoPosterResult {
  dataUri: string
  width: number
  height: number
  durationMs?: number
}

/** The slice of `RelayClient` the loader needs; tests hand in a fake. */
export interface VideoPosterHost {
  request(command: RemoteCommand, timeoutMs: number): Promise<unknown>
}

export interface VideoPosterRequest {
  host: VideoPosterHost
  projectPath: string
  sessionId: string | null
  path: string
}

/** Cutting a frame is a decode on the host; a cold one takes well under a second. */
const POSTER_TIMEOUT_MS = 20_000
/** Posters are a few kilobytes each; a count cap is all the bound they need. */
const POSTER_CACHE_LIMIT = 256

/**
 * Posters by `project\0path`, insertion-ordered so eviction is oldest-first.
 * `null` is remembered too: a clip the host cannot decode stays a chip
 * without asking again every time the row remounts.
 */
const cache = new Map<string, VideoPosterResult | null>()

function remember(key: string, poster: VideoPosterResult | null): void {
  cache.set(key, poster)
  if (cache.size > POSTER_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

/** Test hook: forget everything. */
export function resetVideoPosterCache(): void {
  cache.clear()
}

/**
 * The first frame of a video the desktop holds, cut on the host and returned
 * in-band on every transport. `null` when the host could not decode the clip
 * (or is too old to answer); the transcript keeps its icon chip.
 */
export async function loadVideoPoster(req: VideoPosterRequest): Promise<VideoPosterResult | null> {
  const target = resolveRemoteFilePath(req.projectPath, req.path)
  const key = `${req.projectPath}\0${target}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const response = await req.host.request({
    type: 'read_video_poster',
    requestId: randomId(),
    projectPath: req.projectPath,
    ...(req.sessionId ? { sessionId: req.sessionId } : {}),
    path: target,
  } as RemoteCommand, POSTER_TIMEOUT_MS) as ReadVideoPosterResponse | { error?: string } | undefined
  if (!response || !('ok' in response)) throw new Error('host cannot cut video posters')
  if (!response.ok) throw new Error(response.message ?? response.error)
  const poster = response.poster
    ? {
        dataUri: `data:${response.poster.mimeType};base64,${response.poster.base64}`,
        width: response.poster.width,
        height: response.poster.height,
        ...(response.poster.durationMs != null ? { durationMs: response.poster.durationMs } : {}),
      }
    : null
  remember(key, poster)
  return poster
}
