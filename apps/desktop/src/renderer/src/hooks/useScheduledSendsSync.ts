import { useEffect } from 'react'
import { connectionIdForProjectKey } from '@/lib/session-list-ops'
import { loadEnvironmentItems } from '@/lib/environment-list'
import { servesMethod } from '@superone/shared/environment/capabilities'
import { useChatStore } from '@/stores/chat-store'
import { findSessionTarget } from '@/stores/chat-store/helpers/store-helpers'
import { useDraftsStore } from '@/stores/drafts'
import { useScheduledSendsStore } from '@/stores/scheduled-sends'

/**
 * Keep the sidebar's view of every queued send current.
 *
 * Mount once, above the sidebar. Reads the whole set at startup and then
 * follows the same change broadcast the composer's own hook listens to — main
 * is the single writer, so there is nothing to reconcile.
 */
export function useScheduledSendsSync(): void {
  useEffect(() => {
    const { load, apply } = useScheduledSendsStore.getState()
    void load()
    void loadEnvironmentItems().then(items => {
      for (const host of items) {
        if (host.connectionId !== 'local' && host.state === 'connected' && servesMethod(host.capabilities, 'sessionList.scheduledSends')) {
          void load(host.connectionId)
        }
      }
    }).catch(() => {})
    return window.environment.onScheduledSendChanged((event) => {
      apply(event.sessionId, event.scheduled, event.connectionId)
      // The draft was this session's only representation while it waited. Once
      // the text has actually gone out the session speaks for itself, and the
      // draft would otherwise sit there forever offering to send it again.
      if (event.delivered) {
        void dropDraftForSession(event.sessionId, event.connectionId)
        clearDeliveredComposer(event.sessionId, event.connectionId)
      }
    })
  }, [])
}

/**
 * The queued send mirrors the composer, so delivery empties it here — a mounted
 * composer clears itself, but one for a session nobody is viewing would
 * otherwise restore what was sent when the user switches back.
 */
function clearDeliveredComposer(sessionId: string, connectionId?: string): void {
  const state = useChatStore.getState()
  const target = findSessionTarget(state, sessionId, connectionId
    ? projectPath => connectionIdForProjectKey(projectPath) === connectionId
    : undefined)
  if (!target) return
  state.setDraftText('', target)
  state.clearAttachments(target)
}

async function dropDraftForSession(sessionId: string, owner?: string): Promise<void> {
  const { byConnection, removeDraft } = useDraftsStore.getState()
  for (const [connectionId, drafts] of Object.entries(byConnection)) {
    if (owner && connectionId !== owner) continue
    const owned = drafts.find((draft) => draft.originSessionId === sessionId)
    if (owned) await removeDraft(connectionId, owned.id)
  }
}
