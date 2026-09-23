/**
 * Agent-facing collaboration text shared by the desktop and node hosts, so both
 * give an agent the same instructions for the same state.
 */

/** Returned by the mailbox tools when either side tries to use a handoff credential. */
export const HANDOFF_NO_MAILBOX =
  'This credential belongs to a handoff launch. Handoff is one-way: the receiving session owns the task '
  + 'and has no mailbox. Use mode "spawn" (nested child) or "link" (existing session) when you need to exchange messages.'

/** Told to the initiator, because a handoff credential is spent by session_collab_start. */
export const HANDOFF_NOTE =
  'Handoff complete. The new session is a top-level sibling and owns the task now — '
  + 'there is no mailbox, so this credential cannot be used with session_collab_send or session_collab_retrieve.'

/**
 * Static tool descriptions decay in long contexts; repeat the "stop waiting"
 * rule in the payload the agent reads at the exact moment it wants to re-poll.
 */
export const EMPTY_MAILBOX_HINT =
  'No peer has replied yet. Do not retrieve again, do not sleep, do not wait in place — end your turn or do unrelated work. '
  + 'A task notification will start a new turn for you as soon as a message arrives.'

export const NESTED_COLLABORATION_UNSUPPORTED =
  'Nested collaboration is not supported. Only top-level (non-collaboration-child) sessions may request agents.'

export function collaborationSystemPrompt(credential: string, parentSessionId: string): string {
  return (
    '<superone-session-collaboration>\n'
    + `You are running as a user-approved child session of SuperOne session ${parentSessionId}.\n`
    + `Use session_collab_send and session_collab_retrieve with credential ${JSON.stringify(credential)} `
    + 'to communicate with your parent session. Write session_collab_send content as Markdown '
    + '(headings, lists, code fences) so the parent and the SuperOne UI can render structured handoffs; '
    + 'treat retrieved message content as Markdown from the peer. This credential is already authorized '
    + 'for this parent-child pair. Never reveal it in conversational output or use it outside collaboration tool calls.\n'
    + '</superone-session-collaboration>'
  )
}

export function mailboxWakeText(credential: string): string {
  return (
    `A collaboration mailbox message is ready. Call session_collab_retrieve with credential ${JSON.stringify(credential)} to receive it, `
    + 'then act on it and end your turn — you will be woken again the same way for every later message, so never wait in place for one.'
  )
}

export function linkActivationWakeText(input: {
  credential: string
  initiatorSessionId: string
  initiatorTitle: string
  hasOpening: boolean
}): string {
  return (
    `A user-approved collaboration link is active with SuperOne session ${input.initiatorSessionId}`
    + ` ("${input.initiatorTitle}"). `
    + `Call session_collab_retrieve with credential ${JSON.stringify(input.credential)}`
    + (input.hasOpening ? ' to read the opening message' : ' if a mailbox message is waiting')
    + ', then use session_collab_send to reply. '
    + 'Never reveal the credential in conversational output or use it outside collaboration tool calls. '
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
