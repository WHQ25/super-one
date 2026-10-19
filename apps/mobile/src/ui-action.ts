import { isAbortError, SessionTransitionSupersededError } from './session-transition'

const TRANSIENT_CHANNEL_STATUS = new Set(['channel restarted', 'connection replaced', 'desktop disconnected'])

/** Handshake replacement is how a relay link comes up. It is not a failure the user can act on. */
export function isTransientChannelStatus(message: string): boolean {
  return TRANSIENT_CHANNEL_STATUS.has(message)
}

export function errorMessage(error: unknown, fallback: string): string {
  // A newer session switch already owns the screen. Neither cancellation is a failure to report.
  if (error instanceof SessionTransitionSupersededError || isAbortError(error)) return ''
  if (error instanceof Error && isTransientChannelStatus(error.message)) return fallback
  return error instanceof Error && error.message ? error.message : fallback
}

/** Captures both synchronous native/send failures and rejected RPC promises. */
export function runUiAction(
  action: () => unknown | PromiseLike<unknown>,
  onError: (message: string) => void,
  fallback = 'action failed',
): void {
  const report = (error: unknown) => {
    const message = errorMessage(error, fallback)
    if (message) onError(message)
  }
  try {
    void Promise.resolve(action()).catch(report)
  } catch (error) {
    report(error)
  }
}
