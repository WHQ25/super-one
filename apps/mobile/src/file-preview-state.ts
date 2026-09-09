import type { ReadDesktopFileError, ReadDesktopFileResponse } from '@superone/shared/agent-types'
import { isInlinePreviewTextName, isMarkdownFileName } from '@superone/shared/file-preview'
import type { TransportKind } from '@superone/relay-client'

/**
 * The file preview page's model.
 *
 * A chip tap in the transcript lands here the way the desktop lands in a
 * `FilePreview` tab. Only what the RPC can hand back in-band is *shown* on
 * this page — small text and Markdown. Everything else becomes a transfer the
 * user can see the size of before it starts, because over the relay it costs
 * the desktop an encrypted upload and the phone a download.
 */
export type FilePreviewState =
  | { kind: 'loading'; path: string; name: string; line?: number }
  | {
      kind: 'text'
      path: string
      name: string
      text: string
      size: number
      /** Render as prose rather than a code listing. */
      markdown: boolean
      /** The cited line the page should anchor and highlight. */
      line?: number
    }
  | {
      kind: 'transfer'
      path: string
      name: string
      size: number
      mimeType: string
      /**
       * Whether the bytes may move without asking. A LAN download is a signed
       * URL on the local network; a relay download stages the file on a third
       * party first, so the user confirms it.
       */
      needsConfirm: boolean
      /** Set once the receive sheet has taken over the download. */
      started: boolean
    }
  | { kind: 'error'; path: string; name: string; message: string }

export const FILE_PREVIEW_TEXT = {
  title: 'Preview',
  loading: 'Loading file…',
  showInFolder: 'Folder',
  relayNotice: 'This file is not small text, so it cannot be shown here. Downloading it over the relay stages an encrypted copy on the relay server first.',
  lanNotice: 'This file is not small text, so it cannot be shown here. It is downloading directly from your desktop.',
  download: 'Download',
  downloading: 'Opening in the receive sheet…',
  retry: 'Try again',
  lineLabel: 'Line',
} as const

/** The last path segment, which is what the page's title shows. */
export function previewFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/**
 * Whether a tap should open the preview page at all.
 *
 * Text-like names always do: either the text arrives inline or the page shows
 * why it did not. A non-text file over the LAN skips the page — it goes straight
 * to the receive sheet as it always has — because there is nothing to confirm and
 * nothing the page could render. Over the relay it opens the page so the user can
 * approve the transfer.
 */
export function previewOpensPage(path: string, transport: TransportKind | null): boolean {
  return isInlinePreviewTextName(previewFileName(path)) || transport !== 'lan'
}

/** Fold the host's `read_desktop_file` answer into the page state. */
export function reducePreviewResponse(
  current: Extract<FilePreviewState, { kind: 'loading' }>,
  response: ReadDesktopFileResponse | ReadDesktopFileError,
  transport: TransportKind | null,
): FilePreviewState {
  const { path, name } = current
  if (!response.ok) {
    return { kind: 'error', path, name, message: response.message ?? response.error }
  }
  if ('inline' in response) {
    return {
      kind: 'text',
      path,
      name,
      text: response.text,
      size: response.size,
      markdown: isMarkdownFileName(name),
      ...(current.line != null ? { line: current.line } : {}),
    }
  }
  return {
    kind: 'transfer',
    path,
    name,
    size: response.size,
    mimeType: response.mimeType,
    needsConfirm: transport !== 'lan',
    started: false,
  }
}
