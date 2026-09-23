/**
 * Agent-facing collaboration text shared by the desktop and node hosts, so both
 * give an agent the same instructions for the same state.
 *
 * Mailbox access is decided by the host from the calling session, so nothing
 * here asks the agent to remember a secret. Wake texts keep their fixed opening
 * sentences: hosts recognise mailbox wakes by them.
 */

/** Returned when an agent tries to message across a handoff. */
export const HANDOFF_NO_MAILBOX =
  'That session was created by a one-way handoff: it owns the task and has no mailbox, so neither side can message '
  + 'the other. Use mode "spawn" (nested child) or "link" (existing session) when you need to exchange messages.'

/** Told to the initiator after a handoff start. */
export const HANDOFF_NOTE =
  'Handoff complete. The new session is a top-level sibling and owns the task now — '
  + 'there is no mailbox, so you cannot message it with session_collab_send.'

/**
 * Static tool descriptions decay in long contexts; repeat the "stop waiting"
 * rule in the payload the agent reads at the exact moment it wants to re-poll.
 */
export const EMPTY_MAILBOX_HINT =
  'No peer has replied yet. Do not retrieve again, do not sleep, do not wait in place — end your turn or do unrelated work. '
  + 'A task notification will start a new turn for you as soon as a message arrives.'

export const NO_PEERS_HINT =
  'You have no collaboration peers. Launch or link one with session_collab_request, then session_collab_start.'

export const NESTED_COLLABORATION_UNSUPPORTED =
  'Nested collaboration is not supported. Only top-level (non-collaboration-child) sessions may request agents.'

export function collaborationSystemPrompt(parentSessionId: string): string {
  return (
    '<superone-session-collaboration>\n'
    + `You are running as a user-approved child session of SuperOne session ${parentSessionId}.\n`
    + 'Your parent is your only collaboration peer: message it with session_collab_send (no `to` needed) and read '
    + 'its messages with session_collab_retrieve. Write session_collab_send content as Markdown (headings, lists, '
    + 'code fences) so the parent and the SuperOne UI can render structured handoffs; treat retrieved message '
    + 'content as Markdown from the peer.\n'
    + '</superone-session-collaboration>'
  )
}

function sessionLabel(sessionId: string, title: string): string {
  return `SuperOne session ${sessionId} ("${title}")`
}

export function mailboxWakeText(from: { sessionId: string; title: string }): string {
  return (
    `A collaboration mailbox message is ready. It is from ${sessionLabel(from.sessionId, from.title)}. `
    + 'Call session_collab_retrieve to receive it, then act on it and end your turn — '
    + 'you will be woken again the same way for every later message, so never wait in place for one.'
  )
}

export function linkActivationWakeText(input: {
  initiatorSessionId: string
  initiatorTitle: string
  hasOpening: boolean
}): string {
  return (
    `A user-approved collaboration link is active with ${sessionLabel(input.initiatorSessionId, input.initiatorTitle)}. `
    + 'Call session_collab_retrieve'
    + (input.hasOpening ? ' to read the opening message' : ' if a mailbox message is waiting')
    + `, then reply with session_collab_send({ to: ${JSON.stringify(input.initiatorSessionId)} }). `
    + 'End your turn after acting — you will be woken again for later messages.'
  )
}

/**
 * Opening body for a handoff receiver. It has no mailbox, so this line is its
 * only way to trace where the work came from.
 */
export function handoffTaskContent(input: {
  parentSessionId: string
  parentTitle: string | null
  task: string
}): string {
  const title = input.parentTitle || input.parentSessionId.slice(0, 8)
  return (
    `> Handed off from SuperOne session \`${input.parentSessionId}\` ("${title}"). `
    + 'This is a one-way handoff: you own this task now and cannot message that session back. '
    + 'Read its context with session_read({ sessionId }) if you need it.\n\n'
    + input.task
  )
}

export function readOnlyTargetMessage(sessionId: string): string {
  return (
    `Cannot wake session ${sessionId}: its worktree directory has been removed and the session is now read-only. `
    + 'Spawn a new child (or hand off) if the work still needs an agent.'
  )
}
