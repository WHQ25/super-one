import { INLINE_RPC_MAX_BYTES } from '@superone/shared/file-preview'
import type { ReadDesktopFileError, ReadDesktopFileResponse, RemoteCommand } from '@superone/shared/agent-types'
import { resolveRemoteFilePath } from './shell-state'
import { randomId } from './ids'

/** The answer the chat WebView's files previewer renders. */
export type TextFileResult =
  | { text: string }
  /** The host will not put the file on the RPC; the card shows a chip instead. */
  | { tooLarge: true; size?: number }

/** The slice of `RelayClient` the loader needs; tests hand in a fake. */
export interface TextFileHost {
  request(command: RemoteCommand, timeoutMs: number): Promise<unknown>
}

export interface TextFileRequest {
  host: TextFileHost
  projectPath: string
  sessionId: string | null
  path: string
  /**
   * Session root the path belongs to (`remote:<conn>:<host>` or a local
   * directory). The desktop resolves `(root, path)` through
   * `resolveSessionFile`, which is what makes a node-zone artifact or a node
   * project file readable from the phone (session-sync-zone.md §4.2).
   */
  root?: string
}

/** Inline text is at most 512 KiB; the relay carries that in a few seconds. */
const TEXT_TIMEOUT_MS = 60_000

/**
 * A text file the desktop holds, for the transcript's files previewer to
 * render in place. This is the same `read_desktop_file` the fullscreen
 * preview opens with, asked with `preferInline` so a small text file comes
 * back in-band on every transport; anything the host will not inline —
 * too large, or bytes that turned out binary — reports `tooLarge` and the
 * card falls back to a chip that opens the preview page. The WebView keeps
 * the text, so nothing is cached here.
 */
export async function loadTextFile(req: TextFileRequest): Promise<TextFileResult> {
  const target = resolveRemoteFilePath(req.projectPath, req.path)
  const response = await req.host.request({
    type: 'read_desktop_file',
    requestId: randomId(),
    projectPath: req.projectPath,
    ...(req.sessionId ? { sessionId: req.sessionId } : {}),
    ...(req.root ? { root: req.root } : {}),
    path: target,
    maxBytes: INLINE_RPC_MAX_BYTES,
    preferInline: true,
    statOnly: true,
  } as RemoteCommand, TEXT_TIMEOUT_MS) as ReadDesktopFileResponse | ReadDesktopFileError | { error?: string } | undefined
  if (!response || !('ok' in response)) throw new Error('host cannot read text files')
  if (!response.ok) {
    if (response.error === 'too_large') return { tooLarge: true }
    throw new Error(response.message ?? response.error)
  }
  if ('inline' in response && 'text' in response) return { text: response.text }
  return { tooLarge: true, size: response.size }
}
