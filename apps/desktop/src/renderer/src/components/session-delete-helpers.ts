import type { HarnessId } from '@superone/shared/agent-types'

export type SessionProvider = HarnessId

const SKIP_DELETE_CONFIRM_KEY = 'super-one.skip-delete-session-confirm'

export function shouldSkipDeleteConfirm(): boolean {
  return globalThis.localStorage?.getItem(SKIP_DELETE_CONFIRM_KEY) === 'true'
}

export function setSkipDeleteConfirm(): void {
  globalThis.localStorage?.setItem(SKIP_DELETE_CONFIRM_KEY, 'true')
}

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
  if (provider === 'acp') {
    return {
      cliName: 'ACP agent',
      resumeCommand: sessionId,
    }
  }
  return {
    cliName: 'Claude Code CLI',
    resumeCommand: `claude --resume ${sessionId}`,
  }
}

