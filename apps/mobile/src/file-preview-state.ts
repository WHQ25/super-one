import type { ImageGenerationInfo, ReadDesktopFileError, ReadDesktopFileResponse } from '@superone/shared/agent-types'
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
 * - `mermaid` — a rendered diagram the transcript already holds as SVG. It
 *   opens a page of its own so pinch-zoom cannot scale the chat WebView.
 * - `text` — small text or Markdown that rode back inside the RPC.
 * - `video` — a clip whose bytes have landed on the phone, played by the
 *   native player over the cache file. Its menu saves to Photos like a picture.
 * - `transfer` — a file that must move as bytes first. Over the relay a file
 *   larger than the RPC cap needs confirmation (the desktop stages an encrypted
 *   copy on R2); over the LAN it starts on its own. A finished transfer becomes
 *   an `image` or a `video`, or stays here with `localUri` set, ready to save
 *   or share.
 */
export type FilePreviewState =
  | {
      kind: 'loading'
      path: string
      name: string
      line?: number
      /**
       * Session root the path belongs to. The desktop resolves `(root, path)`
       * through `resolveSessionFile`, which is what lets the page open a file
       * that lives on a remote node (session-sync-zone.md §4.2).
       */
      root?: string
    }
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
      /** For a generated image: what the info panel shows. */
      generation?: ImageGenerationInfo
    }
  | {
      kind: 'video'
      path: string
      name: string
      /** The cache file the bytes were written to; what the player and the menu use. */
      localUri: string
      mimeType: string
      size: number
    }
  | {
      kind: 'mermaid'
      /** The SVG mermaid.render already painted in the transcript. */
      svg: string
      name: string
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
      /** Carried from the loading state so a confirmed download re-asks with the same root. */
      root?: string
      size: number
      mimeType: string
      /**
       * Whether the bytes may move without asking. A LAN download is a signed
       * URL on the local network; a relay download that still needs R2 staging
       * asks first. Small relay files arrive inline and skip this.
       */
      needsConfirm: boolean
      phase: 'idle' | 'downloading' | 'ready'
      /** Host mtime; a later edit misses the on-phone cache. */
      modifiedAt?: number
      /** Bytes on the phone so far, mapped onto `size`. Only while downloading. */
      receivedBytes?: number
      /** The cache file the bytes were written to, once `phase` is `ready`. */
      localUri?: string
      /** In-band bytes from the RPC; the hook writes them instead of downloading. */
      inlineBase64?: string
    }
  | { kind: 'error'; path: string; name: string; message: string }

export const FILE_PREVIEW_TEXT = {
  loading: 'Loading file…',
  download: 'Download',
  downloading: 'Downloading…',
  ready: 'Downloaded. Use the menu to save or share it.',
  retry: 'Try again',
  more: 'More',
  menuTitle: 'File',
  saveToPhotos: 'Save to Photos',
  saveToFiles: 'Save to Files',
  share: 'Share',
  savedToPhotos: 'Saved to Photos',
  savedToFiles: 'Saved',
  photosDenied: 'Allow photo library access in Settings to save photos and videos.',
  videoFailed: 'Video failed to load',
  openSettings: 'Open Settings',
  sharingUnavailable: 'Sharing is unavailable on this device',
  imageFailed: 'Image failed to load',
  rotateLeft: 'Rotate left',
  rotateRight: 'Rotate right',
  imageInfo: 'Image info',
  generatedIn: 'Generated in',
  noMetadata: 'No metadata available.',
  prompt: 'Prompt',
  copyPrompt: 'Copy prompt',
  promptCopied: 'Prompt copied',
  warnings: 'Warnings',
  paramProvider: 'Provider',
  paramModel: 'Model',
  paramSize: 'Size',
  paramAspectRatio: 'Aspect ratio',
  paramReferenceImages: 'Reference images',
  mermaid: 'Mermaid',
} as const

/** Labels for the parameter keys a generation reports; anything else shows its raw key. */
export const IMAGE_PARAM_LABELS: Record<string, string> = {
  provider: FILE_PREVIEW_TEXT.paramProvider,
  model: FILE_PREVIEW_TEXT.paramModel,
  size: FILE_PREVIEW_TEXT.paramSize,
  aspectRatio: FILE_PREVIEW_TEXT.paramAspectRatio,
}

/** `1.2s` / `850ms`, as the desktop viewer formats a generation time. */
export function formatGenerationDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** The last path segment, which is what the page's title shows. */
export function previewFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/**
 * Filename the chrome FileTypeIcon resolves against — the same Symbols artwork
 * a file chip uses. Mermaid is a rendered diagram, not a file, so it has none.
 */
export function previewChromeIconName(state: FilePreviewState): string | null {
  if (state.kind === 'mermaid') return null
  return state.name
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

/**
 * Map an HTTP progress event onto the file's plaintext `size`, so the bar
 * never overshoots even when the on-the-wire payload is an encrypted envelope.
 */
export function mapTransferProgress(received: number, total: number, size: number): number {
  if (!Number.isFinite(received) || received <= 0 || !Number.isFinite(size) || size <= 0) return 0
  if (Number.isFinite(total) && total > 0) {
    return Math.min(size, Math.round((received / total) * size))
  }
  return Math.min(size, Math.round(received))
}

/** The state a mermaid diagram the transcript already rendered opens into. */
export function mermaidPreviewState(svg: string): Extract<FilePreviewState, { kind: 'mermaid' }> {
  return { kind: 'mermaid', svg, name: FILE_PREVIEW_TEXT.mermaid }
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
    ...(target.generation ? { generation: target.generation } : {}),
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
  const { path, name, root } = current
  if (!response.ok) {
    return { kind: 'error', path, name, message: response.message ?? response.error }
  }
  if ('inline' in response) {
    if ('text' in response) {
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
    if ('base64' in response) {
      if (response.mimeType.startsWith('image/')) {
        return {
          kind: 'image',
          path,
          name,
          src: `data:${response.mimeType};base64,${response.base64}`,
          mimeType: response.mimeType,
        }
      }
      return {
        kind: 'transfer',
        path,
        name,
        ...(root ? { root } : {}),
        size: response.size,
        mimeType: response.mimeType,
        needsConfirm: false,
        phase: 'idle',
        modifiedAt: response.modifiedAt,
        inlineBase64: response.base64,
      }
    }
  }
  return {
    kind: 'transfer',
    path,
    name,
    ...(root ? { root } : {}),
    size: response.size,
    mimeType: response.mimeType,
    needsConfirm: transport !== 'lan',
    phase: 'idle',
    modifiedAt: response.modifiedAt,
  }
}

/** Decode in-band file bytes; the host's `size` is the plaintext length. */
export function decodeInlineBase64(base64: string, expectedSize: number): Uint8Array {
  const bytes = typeof Buffer !== 'undefined'
    ? new Uint8Array(Buffer.from(base64, 'base64'))
    : Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  if (bytes.byteLength !== expectedSize) throw new Error('download: inline size mismatch')
  return bytes
}

/**
 * Where a finished transfer lands: a picture becomes the image body and a
 * clip the video body, both over the cache file the bytes were written to;
 * anything else stays a transfer card that now has bytes to save or share.
 */
export function completeTransfer(
  current: Extract<FilePreviewState, { kind: 'transfer' }>,
  localUri: string,
): FilePreviewState {
  if (current.mimeType.startsWith('image/')) {
    return { kind: 'image', path: current.path, name: current.name, src: localUri, mimeType: current.mimeType }
  }
  if (current.mimeType.startsWith('video/')) {
    return { kind: 'video', path: current.path, name: current.name, localUri, mimeType: current.mimeType, size: current.size }
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
  if (state.kind === 'video') {
    return { kind: 'file', uri: state.localUri, name: state.name, mimeType: state.mimeType }
  }
  if (state.kind === 'transfer' && state.phase === 'ready' && state.localUri) {
    return { kind: 'file', uri: state.localUri, name: state.name, mimeType: state.mimeType }
  }
  return null
}

/** The two things the menu offers, and whether each can run right now. */
export interface FilePreviewMenu {
  /** Pictures and clips go to the photo library; everything else to a folder the user picks. */
  save: { enabled: boolean; toPhotos: boolean }
  share: { enabled: boolean }
}

export function filePreviewMenu(state: FilePreviewState | null): FilePreviewMenu {
  const source = state ? previewLocalSource(state) : null
  const enabled = source !== null
  return {
    save: { enabled, toPhotos: state?.kind === 'image' || state?.kind === 'video' },
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
