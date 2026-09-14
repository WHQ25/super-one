/**
 * The producers' side of the delivery record
 * (`docs/design/session-sync-zone-delivery-record.md` §4).
 *
 * A zone file enters the record in one of two ways, and the difference is
 * whether there is an `await` between its first byte and its registration:
 *
 * - **Reserved before its first byte.** A path factory (`reserveDownloadPath`,
 *   `createActionRecordingPath`) hands a path to a writer that will fill it
 *   over time — a response body, a helper's recorder. The row is created at
 *   `writing` *before the path leaves the factory*, so a directory mirror that
 *   runs mid-stream finds the file spoken for. `sealZoneFile` closes it once
 *   the writer says the bytes are all there.
 * - **Published complete in one synchronous sequence.** A screenshot, a spilled
 *   text result, a generated image: the bytes are in memory, written with
 *   `writeFileSync`, and registered in the same tick. Nothing can run between
 *   the write and the row, so the row is created directly at `sealed`.
 *
 * Both fix the content identity — size and hash — at seal (R6), and both name
 * the destination from explicit context: the call scope for a tool-driven
 * producer, an explicit connection for an event-driven one, the zone's owner
 * marker for a producer running outside any call. A zone file with no known
 * destination is refused, not guessed local: guessed local means unprotected
 * and undelivered, which is worse than a clear failure.
 *
 * A later observation of a path that already has a row — a second listing, a
 * re-registration at a status boundary — returns that row's id (R3a). A path
 * is written once per session (R2); a new version is a new path.
 */
import { createHash } from 'node:crypto'
import { closeSync, openSync, readSync } from 'node:fs'
import {
  abandonDelivery,
  advanceDelivery,
  findDeliveryByPath,
  releaseDelivery,
  reserveDelivery,
  type DeliveryHandle,
  type DeliveryOrigin,
} from '../db-session-deliveries'
import log from '../logger'
import { ADHOC_SESSION_ID, isUnderSyncZone, zoneArtifactRef, zoneRelativePath } from '../media-output-paths'
import { currentCallOwner, registerArtifact, type ArtifactRef } from '../mcp/artifact-registry'
import { mintHolder, retireHolder } from './delivery-holders'
import { canonicalClaimPath } from './sync-zone-paths'
import { readZoneOwner } from './zone-owner'

export type ZoneDestination = { kind: 'local' } | { kind: 'remote'; connectionId: string } | { kind: 'unknown' }

/**
 * Where a session's zone files are going. Explicit beats scope beats marker;
 * the adhoc zone is always this desktop's own.
 */
export function zoneDestination(sessionId: string, explicit?: string | null): ZoneDestination {
  if (sessionId === ADHOC_SESSION_ID) return { kind: 'local' }
  if (explicit !== undefined) return explicit ? { kind: 'remote', connectionId: explicit } : { kind: 'local' }
  const scoped = currentCallOwner()
  if (scoped !== undefined) return scoped ? { kind: 'remote', connectionId: scoped } : { kind: 'local' }
  const marked = readZoneOwner(sessionId)
  if (marked === undefined) return { kind: 'unknown' }
  return marked ? { kind: 'remote', connectionId: marked } : { kind: 'local' }
}

export class ZoneDeliveryRefused extends Error {
  constructor(
    readonly reason: 'session-dropped' | 'path-taken' | 'unknown-destination',
    path: string,
  ) {
    super(`zone delivery refused (${reason}): ${path}`)
    this.name = 'ZoneDeliveryRefused'
  }
}

/**
 * Attempts this process's producers currently hold, by canonical path. This
 * is liveness — which holder token a running writer is using — not delivery
 * state; the row is the state. It dies with the process, as the holders do.
 */
const open = new Map<string, DeliveryHandle>()
const keyOf = (sessionId: string, path: string): string => `${sessionId}\t${canonicalClaimPath(path)}`

interface ZoneFileInput {
  sessionId: string
  path: string
  origin: DeliveryOrigin
  /** For producers outside a call scope that know their node (a page download's tab driver). */
  connectionId?: string | null
}

function destinationOrRefuse(input: ZoneFileInput): string | null {
  const dest = zoneDestination(input.sessionId, input.connectionId)
  if (dest.kind === 'local') return null
  if (dest.kind === 'unknown') throw new ZoneDeliveryRefused('unknown-destination', input.path)
  return dest.connectionId
}

/**
 * Speak for a path a writer is about to fill. Returns the delivery id, or null
 * when there is nothing to deliver — a local session, a path outside the zone.
 * Throws `ZoneDeliveryRefused` when the file would be promised to nobody.
 */
export function reserveZoneFile(input: ZoneFileInput): string | null {
  if (!isUnderSyncZone(input.path)) return null
  const connectionId = destinationOrRefuse(input)
  if (!connectionId) return null
  const holder = mintHolder()
  const r = reserveDelivery({
    sessionId: input.sessionId,
    connectionId,
    localPath: input.path,
    relativePath: relativeOf(input.sessionId, input.path),
    origin: input.origin,
    phase: 'writing',
    holder,
  })
  if ('refused' in r) {
    retireHolder(holder)
    throw new ZoneDeliveryRefused(r.refused, input.path)
  }
  open.set(keyOf(input.sessionId, input.path), { deliveryId: r.deliveryId, holder, epoch: 0 })
  return r.deliveryId
}

/**
 * The bytes at `path` are all there. Seals a reservation this process holds,
 * publishes a file that was never reserved, or — for a path that already has
 * a row — returns that row's id without touching it. `bytes` lets a producer
 * that still has the buffer skip re-reading the file for its hash.
 */
export function sealZoneFile(input: ZoneFileInput & { bytes?: Buffer | string }): string | null {
  if (!isUnderSyncZone(input.path)) return null
  const key = keyOf(input.sessionId, input.path)
  const held = open.get(key)
  if (held) {
    open.delete(key)
    try {
      const identity = contentIdentity(input.path, input.bytes)
      const sealed = advanceDelivery(held, { from: 'writing', to: 'sealed', ...identity })
      if (sealed.ok) releaseDelivery(sealed.handle)
    } finally {
      retireHolder(held.holder)
    }
    return held.deliveryId
  }
  const existing = findDeliveryByPath(input.sessionId, input.path)
  if (existing) return existing.deliveryId
  const connectionId = destinationOrRefuse(input)
  if (!connectionId) return null
  const r = reserveDelivery({
    sessionId: input.sessionId,
    connectionId,
    localPath: input.path,
    relativePath: relativeOf(input.sessionId, input.path),
    origin: input.origin,
    phase: 'sealed',
    holder: null,
    ...contentIdentity(input.path, input.bytes),
  })
  if ('refused' in r) throw new ZoneDeliveryRefused(r.refused, input.path)
  return r.deliveryId
}

/** The writer gave up before sealing. Nothing will carry the file; the row protects nothing. */
export function abandonZoneFile(sessionId: string, path: string): void {
  const key = keyOf(sessionId, path)
  const held = open.get(key)
  if (!held) return
  open.delete(key)
  try {
    abandonDelivery(held)
  } finally {
    retireHolder(held.holder)
  }
}

/** The id of a reservation this process holds for `path`, if any. */
export function openZoneReservation(sessionId: string, path: string): string | null {
  return open.get(keyOf(sessionId, path))?.deliveryId ?? null
}

/**
 * TEMPORARY — step 2 of the delivery-record work (§10 of the design).
 *
 * Producers write the record beside the old claim/handoff/job registries, and
 * nothing consumes it until step 3. Until then a failure to record is logged,
 * not raised, so the old path keeps working exactly as before. Step 3 deletes
 * this function: a refusal becomes the operation's failure (§4, "a desktop
 * that cannot write its database does not start a transfer").
 */
export function recordTolerantly<T>(what: string, fn: () => T): T | null {
  try {
    return fn()
  } catch (err) {
    log.warn('[zone-delivery] could not record %s (old path continues): %s', what, err instanceof Error ? err.message : String(err))
    return null
  }
}

/**
 * What producers call instead of `registerArtifact`: seal or publish the file
 * in the record, then register the ref with its delivery id so the Host Action
 * that pushes it goes straight to the row.
 */
export function publishArtifact(sessionId: string, ref: ArtifactRef & { bytes?: Buffer | string; connectionId?: string | null }): void {
  const { bytes, connectionId, ...plain } = ref
  const origin: DeliveryOrigin = ref.producer === 'download' ? 'download' : 'produced'
  const deliveryId = ref.final
    ? recordTolerantly(ref.path, () => sealZoneFile({ sessionId, path: ref.path, origin, connectionId, bytes }))
    : openZoneReservation(sessionId, ref.path)
  registerArtifact(sessionId, deliveryId ? { ...plain, deliveryId } : plain)
}

/**
 * A backend that writes a capture it does not register — the registrar is
 * the device executor, later — seals the row in the same synchronous
 * sequence as its write, so nothing can run between the file and the record.
 */
export function publishZoneFileAt(path: string, bytes: Buffer): void {
  const ref = zoneArtifactRef(path)
  if (!ref) return
  recordTolerantly(path, () => sealZoneFile({ sessionId: ref.sessionId, path, origin: 'produced', bytes }))
}

/** Tests only. */
export function _resetZoneDeliveryForTests(): void {
  for (const held of open.values()) retireHolder(held.holder)
  open.clear()
}

// ---------------------------------------------------------------------------

function relativeOf(sessionId: string, path: string): string {
  const zone = zoneRelativePath(path)
  if (!zone || zone.sessionId !== sessionId) throw new Error(`${path} is not in session ${sessionId}'s zone`)
  return zone.relativePath
}

/** Size and sha256, from the buffer when the producer still has it, else from the file, in bounded memory. */
function contentIdentity(path: string, bytes?: Buffer | string): { total: number; sha256: string } {
  if (bytes !== undefined) {
    const buf = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes
    return { total: buf.length, sha256: createHash('sha256').update(buf).digest('hex') }
  }
  const hash = createHash('sha256')
  const fd = openSync(path, 'r')
  try {
    const chunk = Buffer.allocUnsafe(1024 * 1024)
    let total = 0
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, null)
      if (n === 0) break
      hash.update(chunk.subarray(0, n))
      total += n
    }
    return { total, sha256: hash.digest('hex') }
  } finally {
    closeSync(fd)
  }
}
