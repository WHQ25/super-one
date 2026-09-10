import type { ReadDesktopFileError, ReadDesktopFileResponse } from '@superone/shared/agent-types'
import { isMarkdownFileName } from '@superone/shared/file-preview'
import type { TransportKind } from '@superone/relay-client'
import { imagePreviewFileName, parseImageDataUri, type ImagePreviewTarget } from './image-preview-state'

/**
 * The fullscreen preview's model.
 *
 * Every picture or file the transcript or the Files browser can be tapped on
 * lands here, the way the desktop lands in a `FilePreview` tab or an image
 * lightbox. The body is chosen by `kind`:
 *
 * - `image` — a zoomable picture. Its `src` is whatever bytes the phone already
 *   holds: the data URI the transcript painted, a cache file a transfer wrote,
 *   or a public URL (which the phone cannot save or share).
 * - `text` — small text or Markdown that rode back inside the RPC.
 * - `transfer` — a file that must move as bytes first. Over the relay the user
 *   confirms it (the desktop stages an encrypted copy on the relay); over the LAN
 *   it starts on its own. A finished transfer either becomes an `image` or stays
 *   here with `localUri` set, ready to save or share.
 */
export type FilePreviewState =
  | { kind: 'loading'; path: string; name: string; line?: number }
  | {
      kind: 'image'
      /** Desktop path when the picture came off the host's disk. */
      path?: string
      /** The file name a saved or shared copy carries. */
      name: string
      /** What the title shows when it is not the file name — a tool label, say. */
      label?: string
      /** `data:image/*`, `file://` or `http(s)://`. */
      src: string
      mimeType: string
    }
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
      phase: 'idle' | 'downloading' | 'ready'
      /** The cache file the bytes were written to, once `phase` is `ready`. */
      localUri?: string
    }
  | { kind: 'error'; path: string; name: string; message: string }

export const FILE_PREVIEW_TEXT = {
  loading: 'Loading file…',
  relayNotice: 'This file is not small text, so it cannot be shown here. Downloading it over the relay stages an encrypted copy on the relay server first.',
  lanNotice: 'This file is not small text, so it cannot be shown here. It is downloading directly from your desktop.',
  download: 'Download',
  downloading: 'Downloading securely…',
  ready: 'Downloaded. Use the menu to save or share it.',
  retry: 'Try again',
  more: 'More',
  menuTitle: 'File',
  saveToPhotos: 'Save to Photos',
  saveToFiles: 'Save to Files',
  share: 'Share',
  savedToPhotos: 'Saved to Photos',
  savedToFiles: 'Saved',
  photosDenied: 'Allow photo library access in Settings to save images.',
  openSettings: 'Open Settings',
  sharingUnavailable: 'Sharing is unavailable on this device',
  imageFailed: 'Image failed to load',
  rotateLeft: 'Rotate left',
  rotateRight: 'Rotate right',
} as const

/** The last path segment, which is what the page's title shows. */
export function previewFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/**
 * A name a cache write can trust: no separators, no control characters, no
 * bare dots, and unique per transfer so two files of the same name cannot
 * overwrite each other while both are on screen.
 */
export function safeCacheFileName(transferId: string, originalName: string): string {
  const basename = originalName.split(/[\\/]/).pop() ?? ''
  const cleaned = basename
    .replace(/[\u0000-\u001f\u007f:]/g, '_')
    .replace(/^\.+$/, '')
    .slice(-120)
  const safeId = transferId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'received'
  return `${safeId}-${cleaned || 'file'}`
}

export function formatFileSize(size: number): string {
  if (size < 1_024) return `${size} B`
  if (size < 1_024 * 1_024) return `${(size / 1_024).toFixed(1)} KB`
  return `${(size / (1_024 * 1_024)).toFixed(1)} MB`
}

/** The state a picture the transcript is already displaying opens into. */
export function imagePreviewState(target: ImagePreviewTarget): Extract<FilePreviewState, { kind: 'image' }> {
  const inline = parseImageDataUri(target.src)
  const mimeType = inline?.mimeType ?? mimeTypeFromName(target.path ?? target.label ?? '') ?? 'image/*'
  return {
    kind: 'image',
    ...(target.path ? { path: target.path } : {}),
    name: imagePreviewFileName(target, mimeType),
    ...(target.label ? { label: target.label } : {}),
    src: target.src,
    mimeType,
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', heic: 'image/heic', avif: 'image/avif',
}

function mimeTypeFromName(name: string): string | null {
  const extension = name.split('.').pop()?.toLowerCase()
  return extension ? MIME_BY_EXTENSION[extension] ?? null : null
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
    phase: 'idle',
  }
}

/**
 * Where a finished transfer lands: a picture becomes the image body over the
 * cache file it was written to; anything else stays a transfer card that now
 * has bytes to save or share.
 */
export function completeTransfer(
  current: Extract<FilePreviewState, { kind: 'transfer' }>,
  localUri: string,
): FilePreviewState {
  if (current.mimeType.startsWith('image/')) {
    return { kind: 'image', path: current.path, name: current.name, src: localUri, mimeType: current.mimeType }
  }
  return { ...current, phase: 'ready', localUri }
}

/**
 * The bytes the menu can act on, in the shape the media ports take. `null`
 * while nothing is on the phone yet — a loading page, a picture by URL, a
 * transfer that has not finished.
 */
export type LocalSource =
  | { kind: 'dataUri'; dataUri: string; name: string; mimeType: string }
  | { kind: 'file'; uri: string; name: string; mimeType: string }
  | { kind: 'text'; text: string; name: string; mimeType: string }

export function previewLocalSource(state: FilePreviewState): LocalSource | null {
  if (state.kind === 'text') {
    return { kind: 'text', text: state.text, name: state.name, mimeType: state.markdown ? 'text/markdown' : 'text/plain' }
  }
  if (state.kind === 'image') {
    if (state.src.startsWith('file://')) return { kind: 'file', uri: state.src, name: state.name, mimeType: state.mimeType }
    const inline = parseImageDataUri(state.src)
    return inline ? { kind: 'dataUri', dataUri: state.src, name: state.name, mimeType: inline.mimeType } : null
  }
  if (state.kind === 'transfer' && state.phase === 'ready' && state.localUri) {
    return { kind: 'file', uri: state.localUri, name: state.name, mimeType: state.mimeType }
  }
  return null
}

/** The two things the menu offers, and whether each can run right now. */
export interface FilePreviewMenu {
  /** Pictures go to the photo library; everything else to a folder the user picks. */
  save: { enabled: boolean; toPhotos: boolean }
  share: { enabled: boolean }
}

export function filePreviewMenu(state: FilePreviewState | null): FilePreviewMenu {
  const source = state ? previewLocalSource(state) : null
  const enabled = source !== null
  return {
    save: { enabled, toPhotos: state?.kind === 'image' },
    share: { enabled },
  }
}

/** What saving reported back, folded into one status line for the chrome. */
export type SaveOutcome = { kind: 'saved'; toPhotos: boolean } | { kind: 'cancelled' } | { kind: 'denied' }

export function describeSaveOutcome(outcome: SaveOutcome): { message: string; offerSettings: boolean } | null {
  if (outcome.kind === 'cancelled') return null
  if (outcome.kind === 'denied') return { message: FILE_PREVIEW_TEXT.photosDenied, offerSettings: true }
  return { message: outcome.toPhotos ? FILE_PREVIEW_TEXT.savedToPhotos : FILE_PREVIEW_TEXT.savedToFiles, offerSettings: false }
}
