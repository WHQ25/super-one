/**
 * Environment protocol and database-schema generation constants.
 *
 * Handshake negotiates overlapping ranges before mutable RPC is enabled.
 * Bump CURRENT_* only when the wire/schema contract changes; keep MIN_* for
 * the oldest generation still supported by this build.
 */

export const PROTOCOL_GENERATION = {
  /** Generation this process speaks when offering connections. */
  current: 1,
  /** Oldest generation this process will accept. */
  min: 1,
  /** Newest generation this process understands. */
  max: 1,
} as const

export const DATABASE_SCHEMA_GENERATION = {
  current: 1,
  min: 1,
  max: 1,
} as const

export interface ProtocolRange {
  current: number
  min: number
  max: number
}

export interface HandshakeGenerations {
  protocol: ProtocolRange
  databaseSchema: ProtocolRange
}

/**
 * Two ranges overlap when each side's accepted interval intersects.
 * Connection is blocked before mutable RPC when ranges do not overlap.
 */
export function rangesOverlap(a: ProtocolRange, b: ProtocolRange): boolean {
  const low = Math.max(a.min, b.min)
  const high = Math.min(a.max, b.max)
  return low <= high
}

/** True when current/min/max are safe integers with min <= current <= max. */
export function isValidProtocolRange(range: unknown): range is ProtocolRange {
  if (!range || typeof range !== 'object') return false
  const r = range as Record<string, unknown>
  const { current, min, max } = r
  if (
    typeof current !== 'number' ||
    typeof min !== 'number' ||
    typeof max !== 'number' ||
    !Number.isSafeInteger(current) ||
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max)
  ) {
    return false
  }
  return min <= current && current <= max
}

export function negotiateHandshake(
  local: HandshakeGenerations,
  remote: HandshakeGenerations,
): { ok: true; protocol: number; databaseSchema: number } | { ok: false; reason: string } {
  if (!isValidProtocolRange(local.protocol) || !isValidProtocolRange(local.databaseSchema)) {
    return { ok: false, reason: 'local handshake ranges are invalid' }
  }
  if (!isValidProtocolRange(remote.protocol) || !isValidProtocolRange(remote.databaseSchema)) {
    return {
      ok: false,
      reason: 'handshake requires valid protocol and databaseSchema ranges (current/min/max integers, min≤current≤max)',
    }
  }
  if (!rangesOverlap(local.protocol, remote.protocol)) {
    return {
      ok: false,
      reason: `protocol generation mismatch: local ${local.protocol.min}-${local.protocol.max}, remote ${remote.protocol.min}-${remote.protocol.max}`,
    }
  }
  if (!rangesOverlap(local.databaseSchema, remote.databaseSchema)) {
    return {
      ok: false,
      reason: `database schema generation mismatch: local ${local.databaseSchema.min}-${local.databaseSchema.max}, remote ${remote.databaseSchema.min}-${remote.databaseSchema.max}`,
    }
  }
  // Prefer the highest mutually supported generation.
  const protocol = Math.min(local.protocol.max, remote.protocol.max)
  const databaseSchema = Math.min(local.databaseSchema.max, remote.databaseSchema.max)
  return { ok: true, protocol, databaseSchema }
}
