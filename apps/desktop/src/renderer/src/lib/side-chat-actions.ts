/**
 * User-level side-chat actions, shared by all three entry points: the chat
 * header menu, the `/side` command, and "Ask in Side Chat" on a text selection.
 *
 * Everything user-facing lives here — the confirm-before-replace rule, the
 * toasts, the dock tab — so the entries stay one call each and cannot drift
 * apart on, say, whether a replace asks first.
 */

import { toast } from 'sonner'
import i18n from 'i18next'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { useChatStore, useSessionScope } from '@/stores/chat'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'

export interface SideChatTarget {
  projectPath: string
  sessionId: string
}

/**
 * The session a side chat would branch from, or null when none can.
 *
 * Returns null for a harness that cannot fork, for an empty draft (nothing to
 * branch), for a remote project (the fork runs on the node, which has no side
 * chat surface yet), and from inside a side chat (branching a scratch thread off
 * a scratch thread is a tab the user cannot get back to).
 */
export function resolveSideChatTarget(): SideChatTarget | null {
  const state = useChatStore.getState()
  const projectPath = state.activeProject
  if (!projectPath || projectPath.startsWith('remote:')) return null
  const project = state.projectSessions[projectPath]
  const sessionId = project?._activeSessionId
  const session = sessionId ? project?._sessions[sessionId] : undefined
  if (!sessionId || !session) return null
  if (session._sideChatParentId) return null
  if (session.messages.length === 0) return null
  if (!HARNESS_CAPABILITIES[resolveProvider(session)].supportsFork) return null
  return { projectPath, sessionId }
}

/**
 * Reactive form of {@link resolveSideChatTarget} for render paths.
 *
 * The eligibility rule reads live session state — harness, message count,
 * whether this *is* a side chat — so a menu built from a one-off read shows a
 * stale entry the moment the session's first message lands.
 */
export function useCanOpenSideChat(sessionId?: string): boolean {
  // A consumer rendered inside a side chat (its own composer) must not offer to
  // open another one: `resolveSideChatTarget` would branch off the PARENT, so
  // the entry would silently replace the very thread the user is typing in.
  const scope = useSessionScope()
  const scopedSessionId = scope?.sessionId
  const inSideChat = useChatStore((s) => {
    if (!scope || !scopedSessionId) return false
    return !!s.projectSessions[scope.projectPath]?._sessions[scopedSessionId]?._sideChatParentId
  })
  const eligible = useChatStore((s) => {
    const projectPath = s.activeProject
    if (!projectPath || projectPath.startsWith('remote:')) return false
    const project = s.projectSessions[projectPath]
    const activeId = project?._activeSessionId
    if (!activeId || (sessionId && sessionId !== activeId)) return false
    const session = project?._sessions[activeId]
    if (!session || session._sideChatParentId || session.messages.length === 0) return false
    return HARNESS_CAPABILITIES[resolveProvider(session)].supportsFork
  })
  return eligible && !inSideChat
}

export interface OpenSideChatOptions {
  /** Text to drop into the side chat's composer as a quote chip. */
  quote?: string
  /**
   * Send this to the open side chat instead of replacing it.
   *
   * "Ask in Side Chat" is a follow-up question, so it belongs in the thread the
   * user already has going — throwing that away to ask about one more selection
   * is the opposite of what they meant. Starting a side chat explicitly (the
   * header menu, `/side`) still means "a fresh one".
   */
  reuseOpen?: boolean
}

/**
 * Open a side chat off the foreground session, replacing any already open.
 *
 * Single-instance by design, so a second request destroys the first — which is
 * why it asks first. A cancelled confirm leaves the existing side chat untouched.
 */
export async function requestSideChat(opts: OpenSideChatOptions = {}): Promise<void> {
  // The side-chat store and the dock API load at call time, not module scope.
  // This file is imported by chat components whose tests mock `@/stores/chat`;
  // a static edge would drag the real store graph in behind that mock and
  // re-enter it mid-initialisation.
  const { openSideChat, useSideChatStore } = await import('@/stores/side-chat')
  const open = useSideChatStore.getState().current
  if (open && opts.reuseOpen) {
    await deliverToSideChat(open.projectPath, open.sessionId, opts.quote)
    return
  }

  const target = resolveSideChatTarget()
  if (!target) {
    toast.error(i18n.t('sideChat.unavailable'))
    return
  }

  if (open) {
    const confirmed = await useSideChatStore.getState().askConfirm('replace')
    if (!confirmed) return
  }

  const toastId = toast.loading(i18n.t('sideChat.openingToast'))
  const result = await openSideChat(target.projectPath, target.sessionId)
  if (!result.ok) {
    toast.error(result.error, { id: toastId })
    return
  }
  toast.dismiss(toastId)

  await deliverToSideChat(result.chat.projectPath, result.chat.sessionId, opts.quote)
}

/** Surface a side chat's tab and land an optional quote in its composer. */
async function deliverToSideChat(projectPath: string, sessionId: string, quote?: string): Promise<void> {
  // Imported at call time, not at module scope: this file is pulled in by chat
  // components, and the dock API's own store imports reach back into them.
  const { focusActivePanelContent, openSideChatTab } = await import('@/components/activity/activity-panel-api')
  openSideChatTab(projectPath, sessionId, i18n.t('sideChat.title'))
  if (quote?.trim()) {
    useChatStore.getState().addUserSelection(quote, { projectPath, sessionId })
  }
  focusActivePanelContent()
}

/**
 * React to the side chat's dock tab disappearing: end the session with it.
 *
 * The tab IS the side chat's lifetime, so every way of removing it — the X, a
 * group close, a middle click — has to stop the turn and dispose the runtime.
 * Hooking the dock's removal event rather than each of those call sites is what
 * makes that true by construction instead of by enumeration.
 *
 * Guarded on the id because a removal is not always a close: restoring a parked
 * layout can re-add and then discard a tab pointing at an already-disposed side
 * chat, and that must not take down the live one opened since.
 */
export async function handleSideChatTabRemoved(sessionId: string | undefined): Promise<void> {
  const { closeSideChat, useSideChatStore } = await import('@/stores/side-chat')
  if (!sessionId || useSideChatStore.getState().current?.sessionId !== sessionId) return
  await closeSideChat()
}

/**
 * Close the side chat after confirming.
 *
 * Only the confirm lives here — dropping the tab is what actually ends the
 * session, so a cancelled confirm returns before touching the dock. The confirm
 * is skipped entirely once the user has ticked "don't ask again".
 */
export async function requestCloseSideChat(): Promise<void> {
  const { closeSideChat, shouldSkipCloseConfirm, useSideChatStore } = await import('@/stores/side-chat')
  const { closeSideChatTab } = await import('@/components/activity/activity-panel-api')
  if (!useSideChatStore.getState().current) {
    closeSideChatTab()
    return
  }
  if (!shouldSkipCloseConfirm()) {
    const confirmed = await useSideChatStore.getState().askConfirm('close')
    if (!confirmed) return
  }
  // Dropping the tab is what disposes the session (`handleSideChatTabRemoved`);
  // this only owns the confirm. Closing here too would race that listener.
  closeSideChatTab()
}
