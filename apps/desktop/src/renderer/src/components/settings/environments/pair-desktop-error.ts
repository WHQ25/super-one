/**
 * Why pairing with a desktop node failed, read from the error message: codes
 * do not survive the IPC boundary, which rejects with the main error's text.
 * Messages come from the node's auth service, the encrypted-channel handshake
 * and the auth client's transport wrapper.
 */
export type PairDesktopFailure =
  | 'expired'
  | 'used'
  | 'channelRequired'
  | 'channelAuth'
  | 'rejected'
  | 'unreachable'

const RULES: Array<[PairDesktopFailure, RegExp]> = [
  ['expired', /pairing token expired/i],
  ['used', /pairing token already used/i],
  ['channelRequired', /channel_required|only inside its encrypted channel/i],
  ['channelAuth', /channel_auth_failed|did not prove the pairing secret|unknown channel key id/i],
  ['rejected', /invalid pairing token|pairing token revoked/i],
  [
    'unreachable',
    /request failed for|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|timed out|timeout|closed during handshake|fetch failed/i,
  ],
]

/** The known failure, or null to show the raw message. */
export function classifyPairDesktopError(message: string): PairDesktopFailure | null {
  return RULES.find(([, pattern]) => pattern.test(message))?.[0] ?? null
}
