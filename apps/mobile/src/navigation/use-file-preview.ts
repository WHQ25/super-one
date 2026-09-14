import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import { File, Paths } from 'expo-file-system'
import { MAX_DOWNLOAD_BYTES, type HttpGet, type RelayClient, type TransportKind } from '@superone/relay-client'
import type { MediaProviderLabel, ReadDesktopFileError, ReadDesktopFileResponse, RemoteCommand } from '@superone/shared/agent-types'
import { hydratePreviewFromCache, hydrateTransferFromCache, persistPreviewToCache } from '../file-preview-cache'
import { getFilePreviewCache } from '../file-preview-cache-store'
import {
  completeTransfer,
  decodeInlineBase64,
  imagePreviewState,
  mapTransferProgress,
  mermaidPreviewState,
  previewFileName,
  reducePreviewResponse,
  safeCacheFileName,
  type FilePreviewState,
} from '../file-preview-state'
import { requestMediaProviderLabels, type ImageGenerationPorts } from '../image-generation-ports'
import type { ImagePreviewTarget } from '../image-preview-state'
import { loadInlineImage } from '../inline-images'
import { resolveRemoteFilePath } from '../shell-state'
import { randomId } from '../ids'

/** How long the phone waits for text or metadata; inline text is at most 512 KiB. */
const PREVIEW_REQUEST_TIMEOUT_MS = 60_000
/** How long a full transfer may take end to end, including the relay staging. */
const TRANSFER_TIMEOUT_MS = 180_000
/** How often the transfer card may repaint while bytes arrive. */
const PROGRESS_THROTTLE_MS = 80
/** Unpaired fallback; connected downloads go through `file-preview-cache`. */
const CACHE_DIRECTORY = 'file-preview'

function persistTransferBytes(
  transfer: Extract<FilePreviewState, { kind: 'transfer' }>,
  pairingId: string | null,
  bytes: Uint8Array,
): string {
  if (pairingId) {
    return getFilePreviewCache().put(
      { pairingId, path: transfer.path, size: transfer.size, modifiedAt: transfer.modifiedAt ?? 0 },
      transfer.name,
      bytes,
    )
  }
  const file = new File(Paths.cache, CACHE_DIRECTORY, safeCacheFileName(randomId(), transfer.name))
  file.create({ overwrite: true, intermediates: true })
  file.write(bytes)
  return file.uri
}

/**
 * React Native's fetch does not reliably expose a readable body, so the
 * transfer card's bar is driven from XMLHttpRequest progress events.
 */
const xhrGet: HttpGet = (url, onProgress) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url)
  xhr.responseType = 'arraybuffer'
  xhr.onprogress = (event) => {
    onProgress?.(event.loaded, event.lengthComputable ? event.total : 0)
  }
  xhr.onload = () => {
    const buffer = xhr.response instanceof ArrayBuffer ? xhr.response : new ArrayBuffer(0)
    resolve({
      ok: xhr.status >= 200 && xhr.status < 300,
      status: xhr.status,
      arrayBuffer: async () => buffer,
    })
  }
  xhr.onerror = () => reject(new Error('Download failed'))
  xhr.onabort = () => reject(new Error('Download cancelled'))
  xhr.send()
})

export type FilePreviewPorts = {
  clientRef: RefObject<RelayClient | null>
  transport: TransportKind | null
  project: { path: string } | null
  sessionId: string | null
  /** Active paired desktop; preview bytes live in this bucket until Forget. */
  pairingId: string | null
}

/**
 * The fullscreen preview's state and the RPCs behind it.
 *
 * `open` takes a desktop path — from a file chip or a Files row — and asks the
 * host for the bytes if they are small or the metadata if they are not, in one
 * `read_desktop_file` round-trip. Small text and small relay binaries land
 * inline; a LAN transfer then starts on its own; a larger relay transfer waits
 * for `startTransfer`, which the Download button calls — that is the
 * confirmation R2 staging asks for. Finished bytes stay on the phone for this
 * pairing across disconnects until Forget, capped at 512 MB, so the same file is
 * not downloaded twice. `showImage` takes a picture the transcript already
 * painted and opens it without any transfer at all. `showMermaid` does the
 * same for a rendered diagram, on a page of its own so pinch-zoom cannot
 * scale the chat WebView.
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
    const { clientRef, project, sessionId, pairingId } = portsRef.current
    const client = clientRef.current
    const current = stateRef.current
    const transfer = target ?? (current?.kind === 'transfer' ? current : null)
    if (!transfer || transfer.phase !== 'idle' || !client || !project) return
    const cached = hydrateTransferFromCache(transfer, pairingId, getFilePreviewCache())
    if (cached !== transfer) {
      setState(cached)
      return
    }
    const mine = generation.current
    setState({ ...transfer, phase: 'downloading', receivedBytes: 0 })
    let lastProgress = 0
    const reportProgress = (received: number, total: number, knownSize: number) => {
      const now = Date.now()
      if (now - lastProgress < PROGRESS_THROTTLE_MS && !(total > 0 && received >= total)) return
      lastProgress = now
      if (generation.current !== mine) return
      setState({
        ...transfer,
        phase: 'downloading',
        receivedBytes: mapTransferProgress(received, total, knownSize),
      })
    }
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
      else if ('url' in response) bytes = await client.downloadDesktopFile(response, xhrGet, (received, total) => reportProgress(received, total, response.size))
      else throw new Error('desktop returned metadata without file data')
      if (generation.current !== mine) return
      if (portsRef.current.pairingId !== pairingId) return
      const downloaded = {
        ...transfer,
        size: bytes.byteLength,
        mimeType: response.mimeType,
        modifiedAt: response.modifiedAt,
      }
      next = completeTransfer(downloaded, persistTransferBytes(downloaded, pairingId, bytes))
    } catch (error) {
      next = { kind: 'error', path: transfer.path, name: transfer.name, message: error instanceof Error ? error.message : 'download failed' }
    }
    if (generation.current !== mine) return
    setState(next)
  }, [setState])

  const open = useCallback(async (path: string, line?: number) => {
    const { clientRef, transport, project, sessionId, pairingId } = portsRef.current
    const client = clientRef.current
    if (!client || !project) throw new Error('no active project')
    const target = resolveRemoteFilePath(project.path, path)
    const loading: Extract<FilePreviewState, { kind: 'loading' }> = {
      kind: 'loading', path: target, name: previewFileName(target), ...(line != null ? { line } : {}),
    }
    const mine = ++generation.current
    setState(loading)
    const read = (preferInline: boolean, statOnly: boolean) => client.request({
      type: 'read_desktop_file',
      requestId: randomId(),
      projectPath: project.path,
      ...(sessionId ? { sessionId } : {}),
      path: target,
      maxBytes: MAX_DOWNLOAD_BYTES,
      preferInline,
      statOnly,
    } as RemoteCommand, PREVIEW_REQUEST_TIMEOUT_MS) as Promise<ReadDesktopFileResponse | ReadDesktopFileError>
    let next: FilePreviewState
    try {
      const cache = getFilePreviewCache()
      const stat = await read(true, true)
      if (generation.current !== mine) return
      if (pairingId && stat.ok) {
        const hit = hydratePreviewFromCache(loading, stat, pairingId, cache)
        if (hit) {
          setState(hit)
          return
        }
      }
      const response = stat
      if (generation.current !== mine) return
      if (portsRef.current.pairingId !== pairingId) return
      next = reducePreviewResponse(loading, response, transport)
      if (response.ok) persistPreviewToCache(next, pairingId, response, cache)
      if (next.kind === 'transfer' && next.inlineBase64 && next.phase === 'idle') {
        const bytes = decodeInlineBase64(next.inlineBase64, next.size)
        if (generation.current !== mine) return
        if (portsRef.current.pairingId !== pairingId) return
        next = completeTransfer(next, persistTransferBytes(next, pairingId, bytes))
      }
    } catch (error) {
      next = { kind: 'error', path: target, name: loading.name, message: error instanceof Error ? error.message : 'failed to read file' }
    }
    if (generation.current !== mine) return
    setState(next)
    if (next.kind === 'transfer' && next.phase === 'idle' && !next.needsConfirm && !next.inlineBase64) void startTransfer(next)
  }, [setState, startTransfer])

  const showImage = useCallback((target: ImagePreviewTarget) => {
    generation.current++
    setState(imagePreviewState(target))
  }, [setState])

  const showMermaid = useCallback((svg: string) => {
    generation.current++
    setState(mermaidPreviewState(svg))
  }, [setState])

  const close = useCallback(() => {
    generation.current++
    setState(null)
  }, [setState])

  const retry = useCallback(() => {
    const current = stateRef.current
    if (!current || current.kind === 'image' || current.kind === 'mermaid') return
    // open() only throws before the page shows anything; the page has a state for it.
    open(current.path, 'line' in current ? current.line : undefined)
      .catch((error) => setState({ kind: 'error', path: current.path, name: current.name, message: error instanceof Error ? error.message : String(error) }))
  }, [open, setState])

  const confirmTransfer = useCallback(() => { void startTransfer() }, [startTransfer])

  // The catalogue is asked for once per pairing: labels only change when the
  // user edits providers on the desktop, and the panel is opened far more often.
  const providerLabels = useRef<{ pairingId: string | null; promise: Promise<MediaProviderLabel[]> } | null>(null)
  const generationPorts = useMemo<ImageGenerationPorts>(() => ({
    async loadImage(path) {
      const client = portsRef.current.clientRef.current
      const project = portsRef.current.project
      if (!client || !project) return null
      const result = await loadInlineImage({
        host: client, transport: portsRef.current.transport, projectPath: project.path,
        sessionId: portsRef.current.sessionId, path, confirmed: false,
      })
      return 'dataUri' in result ? result.dataUri : null
    },
    listMediaProviders() {
      const client = portsRef.current.clientRef.current
      if (!client) return Promise.resolve([])
      const pairingId = portsRef.current.pairingId
      if (providerLabels.current?.pairingId !== pairingId) {
        const promise = requestMediaProviderLabels(client).catch(() => {
          providerLabels.current = null
          return []
        })
        providerLabels.current = { pairingId, promise }
      }
      return providerLabels.current.promise
    },
  }), [])

  return { state, open, showImage, showMermaid, close, startTransfer: confirmTransfer, retry, generationPorts }
}
