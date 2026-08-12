/**
 * Options for selectProject when the user is configuring a draft / new-session
 * surface. Always carries the open unsent draft onto the chosen project.
 */
export function withDraftCarry(
  options?: { connectionId?: string; projectId?: string },
): { connectionId?: string; projectId?: string; carryOpenDraft: true } {
  return { ...options, carryOpenDraft: true }
}
