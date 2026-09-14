import type { RemoteResponder } from '../remote-control-service'
import log from '../logger'

/** Confirm admission, not completion of the provider turn. */
export async function withTurnReceipt(
  requestId: string | undefined,
  respond: RemoteResponder | undefined,
  deliver: (onAccepted?: () => void) => Promise<void>,
): Promise<void> {
  let accepted = false
  const onAccepted = requestId ? async () => {
    if (accepted) return
    accepted = true
    try { await respond?.(requestId, { ok: true }) }
    catch (error) { log.warn('[RemoteControl] Could not deliver turn receipt:', error) }
  } : undefined
  try { await deliver(onAccepted) }
  catch (error) {
    if (!requestId || accepted) throw error
    await respond?.(requestId, { error: error instanceof Error ? error.message : String(error) })
  }
}
