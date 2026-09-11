import { useCallback, useRef, useState, type RefObject } from 'react'
import { File, Paths } from 'expo-file-system'
import { MAX_DOWNLOAD_BYTES, type RelayClient, type TransportKind } from '@superone/relay-client'
import type { ReadDesktopFileError, ReadDesktopFileResponse, RemoteCommand } from '@superone/shared/agent-types'
import {
  completeTransfer,
  decodeInlineBase64,
  imagePreviewState,
  previewFileName,
  reducePreviewResponse,
  safeCacheFileName,
  type FilePreviewState,
} from '../file-preview-state'
import type { ImagePreviewTarget } from '../image-preview-state'
import { resolveRemoteFilePath } from '../shell-state'
import { randomId } from '../ids'

/** How long the phone waits for text or metadata; inline text is at most 512 KiB. */
const PREVIEW_REQUEST_TIMEOUT_MS = 60_000
/** How long a full transfer may take end to end, including the relay staging. */
const TRANSFER_TIMEOUT_MS = 180_000
/** Where downloaded files land; the cache is the OS's to reclaim. */
const CACHE_DIRECTORY = 'file-preview'

export type FilePreviewPorts = {
  clientRef: RefObject<RelayClient | null>
  transport: TransportKind | null
  project: { path: string } | null
  sessionId: string | null
}

/**
 * The fullscreen preview's state and the RPCs behind it.
 *
 * `open` takes a desktop path — from a file chip or a Files row — and asks the
 * host for the bytes if they are small or the metadata if they are not, in one
 * `read_desktop_file` round-trip. Small text and small relay binaries land
 * inline; a LAN transfer then starts on its own; a larger relay transfer waits
 * for `startTransfer`, which the Download button calls — that is the
 * confirmation R2 staging asks for. `showImage` takes a picture the transcript
 * already painted and opens it without any transfer at all.
 */
export function useFilePreview(ports: FilePreviewPorts) {
  const [state, setStateValue] = useState<FilePreviewState | null>(null)
  // Mirrors `state` so callbacks can read the latest value without re-binding.
  const stateRef = useRef<FilePreviewState | null>(null)
  const setState = useCallback((next: FilePreviewState | null) => {
    stateRef.current = next
    setStateValue(next)
  }, [])
  // Only the newest open() may write its answer back; an older one that resolves
  // late — or one the user has since closed — must not overwrite the page.
  const generation = useRef(0)
  const portsRef = useRef(ports)
  portsRef.current = ports

  const startTransfer = useCallback(async (target?: Extract<FilePreviewState, { kind: 'transfer' }>) => {
    const { clientRef, project, sessionId } = portsRef.current
    const client = clientRef.current
    const current = stateRef.current
    const transfer = target ?? (current?.kind === 'transfer' ? current : null)
    if (!transfer || transfer.phase !== 'idle' || !client || !project) return
    const mine = generation.current
    setState({ ...transfer, phase: 'downloading' })
    let next: FilePreviewState
    try {
      const response = await client.request({
        type: 'read_desktop_file',
        requestId: randomId(),
        projectPath: project.path,
        ...(sessionId ? { sessionId } : {}),
        path: transfer.path,
        maxBytes: MAX_DOWNLOAD_BYTES,
        preferInline: true,
      } as RemoteCommand, TRANSFER_TIMEOUT_MS) as ReadDesktopFileResponse | ReadDesktopFileError
      if (!response.ok) throw new Error(response.message ?? response.error)
      let bytes: Uint8Array
      if ('base64' in response) bytes = decodeInlineBase64(response.base64, response.size)
      else if ('url' in response) bytes = await client.downloadDesktopFile(response)
      else throw new Error('desktop returned metadata without file data')
      const file = new File(Paths.cache, CACHE_DIRECTORY, safeCacheFileName(randomId(), transfer.name))
      file.create({ overwrite: true, intermediates: true })
      file.write(bytes)
      next = completeTransfer(transfer, file.uri)
    } catch (error) {
      next = { kind: 'error', path: transfer.path, name: transfer.name, message: error instanceof Error ? error.message : 'download failed' }
    }
    if (generation.current !== mine) return
    setState(next)
  }, [setState])

  const open = useCallback(async (path: string, line?: number) => {
    const { clientRef, transport, project, sessionId } = portsRef.current
    const client = clientRef.current
    if (!client || !project) throw new Error('no active project')
    const target = resolveRemoteFilePath(project.path, path)
    const loading: Extract<FilePreviewState, { kind: 'loading' }> = {
      kind: 'loading', path: target, name: previewFileName(target), ...(line != null ? { line } : {}),
    }
    const mine = ++generation.current
    setState(loading)
    let next: FilePreviewState
    try {
      const response = await client.request({
        type: 'read_desktop_file',
        requestId: randomId(),
        projectPath: project.path,
        ...(sessionId ? { sessionId } : {}),
        path: target,
        maxBytes: MAX_DOWNLOAD_BYTES,
        preferInline: true,
        statOnly: true,
      } as RemoteCommand, PREVIEW_REQUEST_TIMEOUT_MS) as ReadDesktopFileResponse | ReadDesktopFileError
      next = reducePreviewResponse(loading, response, transport)
      if (next.kind === 'transfer' && next.inlineBase64) {
        const bytes = decodeInlineBase64(next.inlineBase64, next.size)
        const file = new File(Paths.cache, CACHE_DIRECTORY, safeCacheFileName(randomId(), next.name))
        file.create({ overwrite: true, intermediates: true })
        file.write(bytes)
        next = completeTransfer({ ...next, phase: 'downloading' }, file.uri)
      }
    } catch (error) {
      next = { kind: 'error', path: target, name: loading.name, message: error instanceof Error ? error.message : 'failed to read file' }
    }
    if (generation.current !== mine) return
    setState(next)
    if (next.kind === 'transfer' && !next.needsConfirm && !next.inlineBase64) void startTransfer(next)
  }, [setState, startTransfer])

  const showImage = useCallback((target: ImagePreviewTarget) => {
    generation.current++
    setState(imagePreviewState(target))
  }, [setState])

  const close = useCallback(() => {
    generation.current++
    setState(null)
  }, [setState])

  const retry = useCallback(() => {
    const current = stateRef.current
    if (!current || current.kind === 'image') return
    // open() only throws before the page shows anything; the page has a state for it.
    open(current.path, 'line' in current ? current.line : undefined)
      .catch((error) => setState({ kind: 'error', path: current.path, name: current.name, message: error instanceof Error ? error.message : String(error) }))
  }, [open, setState])

  const confirmTransfer = useCallback(() => { void startTransfer() }, [startTransfer])

  return { state, open, showImage, close, startTransfer: confirmTransfer, retry }
}
