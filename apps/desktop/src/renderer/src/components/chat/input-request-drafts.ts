import { useCallback } from 'react'
import type { SchemaFormComposerDraft } from '../schema-form/SchemaFormComposer'
import { useChatStore } from '@/stores/chat'
import { useSessionScope, type SessionScope } from '@/stores/chat-store/session-scope'
import { resolveWriteScope } from '@/stores/chat-store/helpers/store-helpers'
import { inputRequestErrorKey, useInputRequestErrors } from '@/stores/chat-store/helpers/input-request-errors'
import { inputRequestDraftCache as drafts } from '@/stores/chat-store/helpers/input-request-draft-cache'

let observing = false

/** Keep drafts across slot preemption and session switches; resolved requests release them. */
function observeRequests() {
  if (observing) return
  observing = true
  useChatStore.subscribe(state => {
    for (const [key, entry] of drafts) {
      const session = state.projectSessions[entry.owner.projectPath]?._sessions[entry.owner.sessionId]
      if (!session?.pendingPermissions.some(request => request.requestId === entry.requestId)) drafts.delete(key)
    }
    const errors = useInputRequestErrors.getState().entries
    const kept = Object.fromEntries(Object.entries(errors).filter(([, entry]) =>
      state.projectSessions[entry.owner.projectPath]?._sessions[entry.owner.sessionId]?.pendingPermissions.some(request => request.requestId === entry.requestId)))
    if (Object.keys(kept).length !== Object.keys(errors).length) useInputRequestErrors.setState({ entries: kept })
  })
}

export function useInputRequestDraft(requestId: string) {
  observeRequests()
  const scope = useSessionScope()
  const fallback = resolveWriteScope(useChatStore.getState())
  const owner = scope ?? (fallback.projectPath && fallback.sessionId
    ? { projectPath: fallback.projectPath, sessionId: fallback.sessionId } : null)
  const key = owner ? JSON.stringify([owner.projectPath, owner.sessionId, requestId]) : null
  const onDraftChange = useCallback((value: SchemaFormComposerDraft) => {
    if (key && owner) drafts.set(key, { owner, requestId, value })
  }, [key, owner?.projectPath, owner?.sessionId, requestId])
  const error = useInputRequestErrors(state => owner ? state.entries[inputRequestErrorKey(owner, requestId)]?.message : undefined)
  return { draft: key ? drafts.get(key)?.value : undefined, onDraftChange, error }
}
