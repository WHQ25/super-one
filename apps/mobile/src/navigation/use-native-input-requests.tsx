import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { PermissionRequest, HarnessId } from '@superone/shared/agent-types'
import { InputRequestDrafts, mobileInputSurfaces, type InputRequestDraft } from '../input-request-state'
import { inputRequestActions } from '../input-request-actions'
import { pickInputRequestFile } from '../input-request-upload'
import { InputRequestComposer } from '../prompts/InputRequestComposer'
import { composerQueuedSendFields } from '../queued-send'
import type { ChatRuntime } from '../runtime'

type InputView = { projectPath: string; sessionId: string; request: PermissionRequest }

/** Keep the root shell's wires small; drafts and actions belong to a captured session. */
export function useNativeInputRequests(options: {
  runtimeRef: RefObject<ChatRuntime | null>; clientRef: RefObject<RelayClient | null>
  connected: boolean; pairingId?: string | null; projectPath?: string; sessionId?: string | null
  sendOptions: Parameters<ChatRuntime['send']>[1]
}) {
  const drafts = useRef(new InputRequestDrafts())
  const [view, setView] = useState<InputView | null>(null)
  useEffect(() => { drafts.current.clear(); setView(null) }, [options.pairingId])
  const sync = (runtime: ChatRuntime) => {
    drafts.current.reconcile(runtime.projectPath, runtime.sessionId, [...runtime.session.pendingPermissions, ...runtime.inputRequestSends.pendingRequests()])
    const surfaces = mobileInputSurfaces(runtime.session)
    setView(current => surfaces.input ? current?.request === surfaces.input && current.projectPath === runtime.projectPath && current.sessionId === runtime.sessionId
      ? current : { projectPath: runtime.projectPath, sessionId: runtime.sessionId, request: surfaces.input } : null)
    return surfaces
  }
  const onDraftChange = useCallback((draft: InputRequestDraft) => {
    if (view) drafts.current.set(view.projectPath, view.sessionId, view.request.requestId, draft)
  }, [view?.projectPath, view?.sessionId, view?.request.requestId])
  const current = () => {
    const runtime = options.runtimeRef.current
    const client = options.clientRef.current
    if (!options.connected || !runtime || !client || !view
      || runtime.projectPath !== view.projectPath || runtime.sessionId !== view.sessionId
      || !runtime.session.pendingPermissions.some(request => request.requestId === view.request.requestId)) throw new Error('This input request is no longer active.')
    return { runtime, client }
  }
  const actions = () => {
    const { runtime, client } = current()
    const queued = composerQueuedSendFields(runtime.session.status, runtime.provider as HarnessId).queue
    return inputRequestActions({ runtime, client, request: view!.request,
      sendOptions: { ...options.sendOptions, ...(queued ? { priority: 'next' } : {}) } })
  }
  const active = view && view.projectPath === options.projectPath && view.sessionId === options.sessionId
  const slot = active ? <InputRequestComposer key={JSON.stringify([view.projectPath, view.sessionId, view.request.requestId])}
    request={view.request} connected={options.connected}
    error={options.runtimeRef.current?.inputRequestSends.errorFor(view.request.requestId)}
    draft={drafts.current.get(view.projectPath, view.sessionId, view.request.requestId)} onDraftChange={onDraftChange}
    onSubmit={values => actions().submit(values)} onCancel={() => actions().cancel()}
    onPickFiles={async field => {
      const { client } = current()
      const chosen = await pickInputRequestFile({ client, projectPath: view.projectPath, sessionId: view.sessionId, requestId: view.request.requestId, field })
      current()
      return chosen
    }} /> : null
  return { sync, slot, resetView: () => setView(null) }
}
