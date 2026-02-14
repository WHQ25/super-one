export type SessionProvider = 'claude' | 'codex'

export function getDeleteSessionRecovery(provider: SessionProvider, sessionId: string): {
  cliName: string
  resumeCommand: string
} {
  if (provider === 'codex') {
    return {
      cliName: 'Codex CLI',
      resumeCommand: `codex resume ${sessionId}`,
    }
  }
  return {
    cliName: 'Claude Code CLI',
    resumeCommand: `claude --resume ${sessionId}`,
  }
}

