import { useCallback, useRef, useState, type RefObject } from 'react'
import { MAX_DOWNLOAD_BYTES, type RelayClient, type TransportKind } from '@superone/relay-client'
import type { ReadDesktopFileError, ReadDesktopFileResponse, RemoteCommand } from '@superone/shared/agent-types'
import { previewFileName, previewOpensPage, reducePreviewResponse, type FilePreviewState } from '../file-preview-state'
import { resolveRemoteFilePath } from '../shell-state'
import { randomId } from '../ids'

/** How long the phone waits for text or metadata; inline text is at most 256 KiB. */
const PREVIEW_REQUEST_TIMEOUT_MS = 60_000

export type FilePreviewPorts = {
  clientRef: RefObject<RelayClient | null>
  transport: TransportKind | null
  project: { path: string } | null
  sessionId: string | null
  /** The receive/share sheet's download path, for files the page cannot render. */
  receiveDesktopFile: (client: RelayClient, projectPath: string, sessionId: string | null, path: string) => Promise<void>
  /** Navigate to the `file-preview` route; the hook owns what it shows. */
  openScreen: () => void
}

/**
 * The file preview page's state and the one RPC behind it.
 *
 * `open` decides between the page and the receive sheet (see `previewOpensPage`),
 * then asks the host for the text if it is small or the metadata if it is not,
 * in a single `read_desktop_file` round-trip. A LAN transfer starts on its own;
 * a relay transfer waits for `startTransfer`, which the page's Download button
 * calls — that is the confirmation the relay route asks for.
 */
export function useFilePreview(ports: FilePreviewPorts) {
  const [state, setStateValue] = useState<FilePreviewState | null>(null)
  // Mirrors `state` so callbacks can read the latest value without re-binding,
  // and so the download side effect never runs inside a state updater.
  const stateRef = useRef<FilePreviewState | null>(null)
  const setState = useCallback((next: FilePreviewState | null) => {
    stateRef.current = next
    setStateValue(next)
  }, [])
  // Only the newest open() may write its answer back; an older one that resolves
  // late would otherwise overwrite a file the user has since moved on to.
  const generation = useRef(0)
  const portsRef = useRef(ports)
  portsRef.current = ports

  const startTransfer = useCallback((target?: Extract<FilePreviewState, { kind: 'transfer' }>) => {
    const { clientRef, project, sessionId, receiveDesktopFile } = portsRef.current
    const client = clientRef.current
    const current = stateRef.current
    const transfer = target ?? (current?.kind === 'transfer' ? current : null)
    if (!transfer || transfer.started || !client || !project) return
    setState({ ...transfer, started: true })
    // receiveDesktopFile reports its own failures inside the receive sheet.
    void receiveDesktopFile(client, project.path, sessionId, transfer.path)
  }, [setState])

  const open = useCallback(async (path: string, line?: number) => {
    const { clientRef, transport, project, sessionId, receiveDesktopFile, openScreen } = portsRef.current
    const client = clientRef.current
    if (!client || !project) throw new Error('no active project')
    const target = resolveRemoteFilePath(project.path, path)
    if (!previewOpensPage(target, transport)) {
      await receiveDesktopFile(client, project.path, sessionId, target)
      return
    }
    const loading: Extract<FilePreviewState, { kind: 'loading' }> = {
      kind: 'loading', path: target, name: previewFileName(target), ...(line != null ? { line } : {}),
    }
    const mine = ++generation.current
    setState(loading)
    openScreen()
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
    } catch (error) {
      next = { kind: 'error', path: target, name: loading.name, message: error instanceof Error ? error.message : 'failed to read file' }
    }
    if (generation.current !== mine) return
    setState(next)
    if (next.kind === 'transfer' && !next.needsConfirm) startTransfer(next)
  }, [setState, startTransfer])

  const retry = useCallback(() => {
    const current = stateRef.current
    if (!current) return
    // open() only throws before the page shows anything; the page has a state for it.
    open(current.path, 'line' in current ? current.line : undefined)
      .catch((error) => setState({ kind: 'error', path: current.path, name: current.name, message: error instanceof Error ? error.message : String(error) }))
  }, [open, setState])

  const confirmTransfer = useCallback(() => startTransfer(), [startTransfer])

  return { state, open, startTransfer: confirmTransfer, retry }
}
