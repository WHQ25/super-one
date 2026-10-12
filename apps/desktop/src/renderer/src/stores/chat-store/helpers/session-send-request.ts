import { HARNESS_STRATEGIES } from '@/harness-ui/strategies'
import type { ChatProvider, PerSessionState } from '../types'

/** Whether a send made now waits behind the running turn; `run` is false for a Codex command such as review. */
export function shouldQueueUserSend(provider: ChatProvider, status: PerSessionState['status'], run = true): boolean {
  if (status !== 'streaming') return false
  const policy = HARNESS_STRATEGIES[provider].queuePolicy
  return policy === 'always' || (policy === 'runs' && run)
}

/** Whether a send that goes out now marks its session streaming before the host reports it. */
export function sendStartsStreaming(provider: ChatProvider, queued: boolean): boolean {
  return !queued && HARNESS_STRATEGIES[provider].sendStartsStreaming === true
}
