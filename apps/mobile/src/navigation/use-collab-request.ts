import { useEffect, useRef } from 'react'
import type { PermissionRequest, SessionAgentRequestPayload } from '@superone/shared/agent-types'
import type { MobileRoute } from './route-state'

export type CollabRequest = { requestId: string; payload: SessionAgentRequestPayload }

/**
 * The one permission kind that gets a page instead of the sheet. Everything
 * else the sheet still owns, so a caller hands it `perm` minus this.
 */
export function collabRequestOf(perm: PermissionRequest | null): CollabRequest | null {
  if (perm?.requestKind !== 'session_agents_confirm' || !perm.sessionAgentsConfirm) return null
  return { requestId: perm.requestId, payload: perm.sessionAgentsConfirm }
}

/**
 * Drives the `collab-request` route off the pending request: a new request opens
 * the page the way the sheet used to open, and the page closes once the request
 * is answered. The answer itself is the caller's — `leave` is what back, the swipe
 * and the hardware button call, and it rejects, because a request the user walked
 * away from is not one they approved.
 *
 * `answered` remembers which request has already been decided, because the host
 * clears `perm` on its own clock: without it, the page would reopen on the next
 * render between the reject going out and the pending request going away.
 */
export function useCollabRequest({ request, screen, setScreen, reject }: {
  request: CollabRequest | null
  screen: MobileRoute
  setScreen: (screen: MobileRoute) => void
  reject: (requestId: string, feedback?: string) => void
}): { open: CollabRequest | null; leave: () => void; answered: (requestId: string) => void } {
  const answeredRef = useRef<string | null>(null)
  const open = request && request.requestId !== answeredRef.current ? request : null

  const onRequest = screen === 'collab-request'
  useEffect(() => {
    if (open && !onRequest) setScreen('collab-request')
    else if (!open && onRequest) setScreen('chat')
  }, [open, onRequest, setScreen])

  // Marking the answer also leaves the page, so the decision does not wait on the
  // host's round trip before the chat is back.
  const answered = (requestId: string) => {
    answeredRef.current = requestId
    setScreen('chat')
  }
  const leave = () => {
    if (!open) return
    answered(open.requestId)
    reject(open.requestId)
  }
  return { open, leave, answered }
}
