/** User confirm window for session_cleanup delete. The desktop dialog uses the same 10 minutes. */
export const SESSION_CLEANUP_CONFIRM_TIMEOUT_MS = 10 * 60_000

/**
 * Host Action deadline for session_cleanup. It has to outlast the confirm:
 * the node cancels the action at this deadline, and a claim cannot be renewed
 * past it. One minute of slack lets the confirm timeout return before that.
 */
export const SESSION_CLEANUP_HOST_ACTION_DEADLINE_MS = SESSION_CLEANUP_CONFIRM_TIMEOUT_MS + 60_000
