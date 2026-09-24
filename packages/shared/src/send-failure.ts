/** Transport / connectivity failures from remote node RPC, relay, or environment host. */
const TRANSPORT_ERROR_RE =
  /not connected|disconnected|connection replaced|websocket closed|rpc timeout|heartbeat|connection blocked|network offline|connection removed|environment is not connected|failed_precondition/i

/** True when a send failed because the host could not be reached, not because it refused. */
export function isTransportSendError(error: string): boolean {
  return TRANSPORT_ERROR_RE.test(error)
}

/**
 * `sendSessionMessage` result when the node accepted the message but following its
 * turn broke off (connection lost mid-stream). Not a send failure: reconnect
 * recovery picks the turn back up, and a resend would run it twice.
 */
export interface RemoteSendDetached {
  streamDetached: true
  error: string
}

export function isRemoteSendDetached(value: unknown): value is RemoteSendDetached {
  return typeof value === 'object' && value !== null && (value as { streamDetached?: unknown }).streamDetached === true
}
