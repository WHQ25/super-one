import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { useChatStore } from '@/stores/chat'

/**
 * Open a collaboration peer in the main chat: focus its mosaic tile when one is
 * open, otherwise switch to it. `projectPath` is the peer's own project — a
 * launch record or the task bubble's metadata — and only the active project when
 * the payload predates that field.
 */
export function openPeerSession(sessionId: string, projectPath?: string | null): void {
  if (!sessionId) return
  void (async () => {
    const target = projectPath?.trim() || useChatStore.getState().activeProject
    if (!target) return
    if (useMosaicStore.getState().focusOrReplaceFocused(target, sessionId)) return
    await useChatStore.getState().switchToSession(target, sessionId)
  })()
}
