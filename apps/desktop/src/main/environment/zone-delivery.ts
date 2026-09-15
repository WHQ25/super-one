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
  claimDelivery,
  findDeliveryByPath,
  getDelivery,
  releaseDelivery,
  reserveDelivery,
  type DeliveryHandle,
  type DeliveryOrigin,
} from '../db-session-deliveries'
import { ADHOC_SESSION_ID, isUnderSyncZone, zoneArtifactRef, zoneRelativePath } from '../media-output-paths'
import { currentCallOwner, holdSealedDelivery, registerArtifact, type ArtifactRef } from '../mcp/artifact-registry'
import { isHolderAlive, mintHolder, retireHolder } from './delivery-holders'
import { canonicalClaimPath } from './sync-zone-paths'
import { readZoneOwner } from './zone-owner'

export type ZoneDestination = { kind: 'local' } | { kind: 'remote'; connectionId: string } | { kind: 'unknown' }

/**
 * Where a session's zone files are going. Explicit beats scope beats marker;
 * the adhoc zone — a capture with no session at all — is always this
 * desktop's own.
 */
export function zoneDestination(sessionId: string, explicit?: string | null): ZoneDestination {
  if (!sessionId || sessionId === ADHOC_SESSION_ID) return { kind: 'local' }
  if (explicit !== undefined) return explicit ? { kind: 'remote', connectionId: explicit } : { kind: 'local' }
  const scoped = currentCallOwner()
  if (scoped !== undefined) return scoped ? { kind: 'remote', connectionId: scoped } : { kind: 'local' }
  const marked = readZoneOwner(sessionId)
  if (marked === undefined) return { kind: 'unknown' }
  return marked ? { kind: 'remote', connectionId: marked } : { kind: 'local' }
}

export type ZoneDeliveryRefusal =
  | 'session-dropped'
  | 'path-taken'
  | 'unknown-destination'
  /** The reservation this process held was invalidated underneath it — the session was dropped mid-write. */
  | 'reservation-lost'

export class ZoneDeliveryRefused extends Error {
  constructor(
    readonly reason: ZoneDeliveryRefusal,
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
  return connectionOf(zoneDestination(input.sessionId, input.connectionId), input.path)
}

function connectionOf(dest: ZoneDestination, path: string): string | null {
  if (dest.kind === 'local') return null
  if (dest.kind === 'unknown') throw new ZoneDeliveryRefused('unknown-destination', path)
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
 * The bytes at `path` are all there. Three intents, told apart rather than
 * guessed:
 *
 * - **Seal** a reservation this process holds. The advance is a compare-and-set;
 *   if it fails the row was taken away underneath us (the session was dropped)
 *   and the seal is refused as `reservation-lost` — never reported as done.
 * - **Publish** a file written just now (`bytes` given) that was never
 *   reserved: a row at `sealed`. A path that already has a row is refused
 *   (`path-taken`): new bytes at an old name is R2's case, not an observation.
 * - **Observe** a path already delivered (no reservation, no `bytes`): a
 *   re-listing or a status boundary naming the file again. Returns the row's
 *   id untouched. A row still `writing` under someone else, or one that was
 *   abandoned, is not observable: the first is a second writer, which `wx`
 *   makes impossible; the second is a name that was burned. Both are refused.
 */
export function sealZoneFile(input: ZoneFileInput & { bytes?: Buffer | string }): string | null {
  if (!isUnderSyncZone(input.path)) return null
  // A local session's zone has no record and never touches the database.
  const dest = zoneDestination(input.sessionId, input.connectionId)
  if (dest.kind === 'local') return null
  const key = keyOf(input.sessionId, input.path)
  const held = open.get(key)
  if (held) {
    open.delete(key)
    let handedToScope = false
    try {
      const identity = contentIdentity(input.path, input.bytes)
      const sealed = advanceDelivery(held, { from: 'writing', to: 'sealed', ...identity })
      if (!sealed.ok) throw new ZoneDeliveryRefused('reservation-lost', input.path)
      // Inside a call the row stays held until the reply-selection runs, so the
      // worker cannot deliver a produced file the agent may never name (E090-4).
      // Outside one — a page download's own completion — it is released now for
      // the worker to carry.
      if (holdSealedDelivery(sealed.handle)) { handedToScope = true; return held.deliveryId }
      if (!releaseDelivery(sealed.handle)) throw new ZoneDeliveryRefused('reservation-lost', input.path)
      return held.deliveryId
    } finally {
      // Any exit that did not hand the row to the call scope frees the holder,
      // so a throw between `open.delete` and the seal (a busy database hashing
      // or advancing) cannot strand a live holder on a `writing` row the worker
      // would then skip for ever (FE99-1). The row keeps the phase it reached; a
      // dead holder is exactly what lets the worker take it over.
      if (!handedToScope) retireHolder(held.holder)
    }
  }
  const existing = findDeliveryByPath(input.sessionId, input.path)
  if (existing) {
    // Observable means a delivery that is happening or has happened. New bytes
    // at an old name, a row still being written by someone else, and a row
    // that was abandoned are none of those: the name is taken, not reusable.
    const observable = input.bytes === undefined && existing.outcome !== 'abandoned' && existing.phase !== 'writing'
    if (!observable) throw new ZoneDeliveryRefused('path-taken', input.path)
    return existing.deliveryId
  }
  // Only a NEW row needs to know where the file is going; an observation of
  // an existing one reads the connection the row already names.
  const connectionId = connectionOf(dest, input.path)
  if (!connectionId) return null
  // Held for the call while it decides (E090-4); a publish outside any call
  // (a device backend's synchronous write) lands unheld for the worker.
  const holder = mintHolder()
  let handedToScope = false
  try {
    const r = reserveDelivery({
      sessionId: input.sessionId,
      connectionId,
      localPath: input.path,
      relativePath: relativeOf(input.sessionId, input.path),
      origin: input.origin,
      phase: 'sealed',
      holder,
      ...contentIdentity(input.path, input.bytes),
    })
    if ('refused' in r) throw new ZoneDeliveryRefused(r.refused, input.path)
    const handle: DeliveryHandle = { deliveryId: r.deliveryId, holder, epoch: r.epoch }
    if (holdSealedDelivery(handle)) { handedToScope = true; return r.deliveryId }
    // No call to decide: release the holder so the worker may claim it.
    if (!releaseDelivery(handle)) throw new ZoneDeliveryRefused('reservation-lost', input.path)
    return r.deliveryId
  } finally {
    // As in the reserved-then-sealed path: unless the scope took the row, the
    // holder is retired even if `reserveDelivery` or hashing threw, so no live
    // holder outlives this call (FE99-1). A sealed row with a dead holder is
    // exactly what the worker claims.
    if (!handedToScope) retireHolder(holder)
  }
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

/**
 * A sealed file nothing will carry: its call ended without naming it in a
 * reply anyone will read, or threw after producing it. Only a row still
 * `sealed` — not queued, not sent, not observed again after delivery — and
 * held by nobody is ended; anything past `sealed` was taken up by a carrier,
 * and a live holder is one (R7).
 */
export function abandonUndeliveredDelivery(deliveryId: string): void {
  const row = getDelivery(deliveryId)
  if (!row || row.outcome || row.phase !== 'sealed' || isHolderAlive(row.holder)) return
  const holder = mintHolder()
  try {
    const claimed = claimDelivery(deliveryId, { holder: row.holder, epoch: row.epoch }, holder)
    if (claimed.ok) abandonDelivery(claimed.handle)
  } finally {
    retireHolder(holder)
  }
}

/** The id of a reservation this process holds for `path`, if any. */
export function openZoneReservation(sessionId: string, path: string): string | null {
  return open.get(keyOf(sessionId, path))?.deliveryId ?? null
}

/**
 * What producers call instead of `registerArtifact`: seal or publish the file
 * in the record, then register the ref with its delivery id so the Host Action
 * that pushes it goes straight to the row.
 */
export function publishArtifact(sessionId: string, ref: ArtifactRef & { bytes?: Buffer | string; connectionId?: string | null }): void {
  const { bytes, connectionId, ...plain } = ref
  const origin: DeliveryOrigin = ref.producer === 'download' ? 'download' : 'produced'
  // A refusal is the record's answer and the producer's failure: a lost
  // reservation, a taken name, a session gone or a destination unknown is
  // never registered as a final ref (§4).
  const deliveryId = ref.final ? sealZoneFile({ sessionId, path: ref.path, origin, connectionId, bytes }) : openZoneReservation(sessionId, ref.path)
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
  sealZoneFile({ sessionId: ref.sessionId, path, origin: 'produced', bytes })
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
