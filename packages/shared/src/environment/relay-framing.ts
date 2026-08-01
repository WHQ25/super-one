/**
 * Environment relay framing (Phase 5).
 * Relay forwards opaque encrypted frames and must not see application method
 * names, resource IDs, prompts, or file data.
 */

export interface RelayFrameHeader {
  /** Routing identifier only — no app semantics. */
  routeId: string
  connectionGeneration: number
  /** Opaque payload size in bytes. */
  payloadBytes: number
  /** Optional flow-control counter. */
  window?: number
  expiresAt?: number
}

export interface RelayFrame {
  header: RelayFrameHeader
  /** End-to-end encrypted ciphertext (base64url). */
  ciphertext: string
}

export function encodeRelayFrame(frame: RelayFrame): string {
  return JSON.stringify({
    h: {
      r: frame.header.routeId,
      g: frame.header.connectionGeneration,
      n: frame.header.payloadBytes,
      w: frame.header.window,
      e: frame.header.expiresAt,
    },
    c: frame.ciphertext,
  })
}

export function decodeRelayFrame(raw: string): RelayFrame {
  const obj = JSON.parse(raw) as {
    h: { r: string; g: number; n: number; w?: number; e?: number }
    c: string
  }
  return {
    header: {
      routeId: obj.h.r,
      connectionGeneration: obj.h.g,
      payloadBytes: obj.h.n,
      window: obj.h.w,
      expiresAt: obj.h.e,
    },
    ciphertext: obj.c,
  }
}

/**
 * Assert a relay-visible frame never carries plaintext application fields.
 * Used by contract tests.
 */
export function assertRelayOpaque(frame: RelayFrame): void {
  const raw = encodeRelayFrame(frame)
  const banned = ['sessions.send', 'permission', 'pairingToken', 'refreshToken', 'prompt']
  for (const b of banned) {
    if (raw.includes(b)) {
      throw new Error(`relay frame must not contain application field marker: ${b}`)
    }
  }
}
