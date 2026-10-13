/** Only declared admission failures prove that a prompt was not submitted. */
export function openCodeSteerWasRejected(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause ?? error : error
  if (!cause || typeof cause !== 'object' || !('_tag' in cause)) return false
  return ['InvalidRequestError', 'UnauthorizedError', 'SessionNotFoundError', 'LocationNotFoundError', 'ConflictError',
    'SkillNotFoundError', 'AgentNotFoundError', 'FileNotFoundError', 'SessionBusyError'].includes(String(cause._tag))
}
