import type { ChatProvider, PerSessionState } from '../types'

export function shouldQueueUserSend(provider: ChatProvider, status: PerSessionState['status'], codexRun = true): boolean {
  return status === 'streaming' && (provider === 'claude' || provider === 'acp'
    || provider === 'opencode' || provider === 'dsh' || (provider === 'codex' && codexRun))
}
