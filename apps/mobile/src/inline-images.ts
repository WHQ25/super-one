import { bytesToBase64String, type TransportKind } from '@superone/relay-client'
import type { ReadDesktopFileError, ReadDesktopFileResponse, RemoteCommand } from '@superone/shared/agent-types'
import { resolveRemoteFilePath } from './shell-state'
import { randomId } from './ids'

/**
 * Largest image the transcript will pull inline. Screenshots and generated
 * stills sit well under this; anything bigger goes through the receive sheet.
 */
export const INLINE_IMAGE_MAX_BYTES = 12 * 1024 * 1024
/** Bytes of decoded image the phone keeps around before evicting the oldest. */
export const INLINE_IMAGE_CACHE_BYTES = 48 * 1024 * 1024
const INLINE_IMAGE_TIMEOUT_MS = 120_000

/** The answer the chat WebView's `PortableHostImage` understands. */
export type InlineImageResult =
  | { dataUri: string }
  | { confirmRequired: true; size?: number }

/** The slice of `RelayClient` the loader needs; tests hand in a fake. */
export interface InlineImageHost {
  request(command: RemoteCommand, timeoutMs: number): Promise<unknown>
  downloadDesktopFile(response: Extract<ReadDesktopFileResponse, { url: string }>): Promise<Uint8Array>
}

export interface InlineImageRequest {
  host: InlineImageHost
  transport: TransportKind | null
  projectPath: string
  sessionId: string | null
  path: string
  /** The user tapped Load on a relay-connected row. */
  confirmed: boolean
}

/**
 * Data URIs by `project\0path`, insertion-ordered so eviction is oldest-first.
 * Scrolling a transcript re-mounts rows constantly; the same screenshot must
 * not cross the relay twice.
 */
const cache = new Map<string, string>()
let cachedBytes = 0

function remember(key: string, dataUri: string): void {
  cache.set(key, dataUri)
  cachedBytes += dataUri.length
  for (const [oldest, value] of cache) {
    if (cachedBytes <= INLINE_IMAGE_CACHE_BYTES || oldest === key) break
    cache.delete(oldest)
    cachedBytes -= value.length
  }
}

/** Test hook: forget everything. */
export function resetInlineImageCache(): void {
  cache.clear()
  cachedBytes = 0
}

function readCommand(req: InlineImageRequest, target: string, statOnly: boolean): RemoteCommand {
  return {
    type: 'read_desktop_file',
    requestId: randomId(),
    projectPath: req.projectPath,
    ...(req.sessionId ? { sessionId: req.sessionId } : {}),
    path: target,
    maxBytes: INLINE_IMAGE_MAX_BYTES,
    ...(statOnly ? { statOnly: true } : {}),
  } as RemoteCommand
}

/**
 * Fetch an image the desktop holds and hand it back as a data URI.
 *
 * Over the LAN this is one `read_desktop_file` plus a direct download. Over the
 * relay the bytes would first be staged encrypted on the relay, so until the
 * row is `confirmed` the loader only asks for the size and returns
 * `confirmRequired` — the WebView turns that into a Load button. A file that
 * is not an image, or is too large, throws; the row then keeps its preview chip.
 */
export async function loadInlineImage(req: InlineImageRequest): Promise<InlineImageResult> {
  const target = resolveRemoteFilePath(req.projectPath, req.path)
  const key = `${req.projectPath}\0${target}`
  const cached = cache.get(key)
  if (cached) return { dataUri: cached }

  if (req.transport !== 'lan' && !req.confirmed) {
    const stat = await req.host.request(readCommand(req, target, true), INLINE_IMAGE_TIMEOUT_MS) as ReadDesktopFileResponse | ReadDesktopFileError
    if (!stat.ok) throw new Error(stat.message ?? stat.error)
    if (!stat.mimeType.startsWith('image/')) throw new Error('not an image')
    return { confirmRequired: true, size: stat.size }
  }

  const response = await req.host.request(readCommand(req, target, false), INLINE_IMAGE_TIMEOUT_MS) as ReadDesktopFileResponse | ReadDesktopFileError
  if (!response.ok) throw new Error(response.message ?? response.error)
  if (!('url' in response)) throw new Error('desktop returned metadata without file data')
  if (!response.mimeType.startsWith('image/')) throw new Error('not an image')
  const bytes = await req.host.downloadDesktopFile(response)
  const dataUri = `data:${response.mimeType};base64,${bytesToBase64String(bytes)}`
  remember(key, dataUri)
  return { dataUri }
}
