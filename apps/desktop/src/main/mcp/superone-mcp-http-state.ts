type HttpSessionCloser = (sessionId: string) => Promise<void>

let closeHttpSessions: HttpSessionCloser | null = null

export function setSuperoneMcpHttpSessionCloser(closer: HttpSessionCloser | null): void {
  closeHttpSessions = closer
}

export async function closeSuperoneMcpHttpSessions(sessionId: string): Promise<void> {
  await closeHttpSessions?.(sessionId)
}
