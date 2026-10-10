import { randomUUID } from 'node:crypto'
import type { ControlLease, SessionRef, TerminalRef } from '@superone/shared/environment'
import type { SqliteDatabase } from '../sqlite'

const DEFAULT_TTL_MS = 30_000
/** Cap client-supplied lease TTL so a single holder cannot pin control indefinitely. */
const MAX_TTL_MS = 15 * 60 * 1000

type ResourceRef = SessionRef | TerminalRef

function resourceKey(resource: ResourceRef): string {
  if ('sessionId' in resource) {
    return `session:${resource.environmentId}:${resource.sessionId}`
  }
  return `terminal:${resource.environmentId}:${resource.terminalId}`
}

function clampTtlMs(ttlMs: number | undefined): number {
  const raw = typeof ttlMs === 'number' && Number.isFinite(ttlMs) ? ttlMs : DEFAULT_TTL_MS
  if (raw <= 0) return DEFAULT_TTL_MS
  return Math.min(raw, MAX_TTL_MS)
}

export class ControlLeaseService {
  private readonly leaseEpoch: string

  constructor(private readonly db: SqliteDatabase) {
    this.leaseEpoch = randomUUID()
  }

  get epoch(): string {
    return this.leaseEpoch
  }

  /**
   * Grant `resource` to a holder. A live lease of another client refuses it;
   * one of another delegate of the same client refuses it too, unless that
   * delegate `yields` (the client's own interface), whose lease is taken over.
   */
  acquire(input: {
    resource: ResourceRef
    holderClientId: string
    delegate?: string
    yields?: boolean
    ttlMs?: number
  }): ControlLease {
    const now = Date.now()
    const ttl = clampTtlMs(input.ttlMs)
    const key = resourceKey(input.resource)
    const delegate = input.delegate ?? ''

    const existing = this.db
      .prepare(
        `SELECT lease_id, holder_client_id, generation, expires_at, epoch, delegate, yields
         FROM control_leases WHERE resource_key = ?`,
      )
      .get(key) as
      | {
          lease_id: string
          holder_client_id: string
          generation: string
          expires_at: number
          epoch: string
          delegate: string
          yields: number
        }
      | undefined

    const live = existing && existing.epoch === this.leaseEpoch && existing.expires_at > now
    if (live && existing.holder_client_id !== input.holderClientId) {
      throw Object.assign(new Error('control lease held by another client'), {
        code: 'failed_precondition',
      })
    }
    if (live && existing.delegate === delegate) {
      const expiresAt = now + ttl
      this.db
        .prepare(`UPDATE control_leases SET expires_at = ?, yields = ? WHERE lease_id = ?`)
        .run(expiresAt, input.yields ? 1 : 0, existing.lease_id)
      return {
        leaseId: existing.lease_id,
        resource: input.resource,
        holderClientId: input.holderClientId,
        ...(delegate ? { delegate } : {}),
        generation: existing.generation,
        expiresAt: new Date(expiresAt).toISOString(),
      }
    }
    if (live && !existing.yields) {
      throw Object.assign(new Error('control lease held by another device'), {
        code: 'failed_precondition',
      })
    }

    const leaseId = randomUUID()
    const generation = existing && existing.epoch === this.leaseEpoch
      ? String(Number(existing.generation || '0') + 1)
      : '1'
    const expiresAt = now + ttl
    this.db
      .prepare(
        `INSERT INTO control_leases (lease_id, resource_key, resource_json, holder_client_id, generation, expires_at, epoch, delegate, yields)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(resource_key) DO UPDATE SET
           lease_id = excluded.lease_id,
           holder_client_id = excluded.holder_client_id,
           generation = excluded.generation,
           expires_at = excluded.expires_at,
           epoch = excluded.epoch,
           resource_json = excluded.resource_json,
           delegate = excluded.delegate,
           yields = excluded.yields`,
      )
      .run(
        leaseId,
        key,
        JSON.stringify(input.resource),
        input.holderClientId,
        generation,
        expiresAt,
        this.leaseEpoch,
        delegate,
        input.yields ? 1 : 0,
      )

    return {
      leaseId,
      resource: input.resource,
      holderClientId: input.holderClientId,
      ...(delegate ? { delegate } : {}),
      generation,
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  renew(input: {
    leaseId: string
    generation: string
    holderClientId: string
    ttlMs?: number
  }): ControlLease {
    const now = Date.now()
    const row = this.db
      .prepare(
        `SELECT lease_id, resource_key, resource_json, holder_client_id, generation, expires_at, epoch
         FROM control_leases WHERE lease_id = ?`,
      )
      .get(input.leaseId) as
      | {
          lease_id: string
          resource_key: string
          resource_json: string
          holder_client_id: string
          generation: string
          expires_at: number
          epoch: string
        }
      | undefined
    if (!row || row.epoch !== this.leaseEpoch) {
      throw Object.assign(new Error('lease required'), { code: 'lease_required' })
    }
    if (row.generation !== input.generation || row.holder_client_id !== input.holderClientId) {
      throw Object.assign(new Error('stale lease generation'), { code: 'lease_stale' })
    }
    if (row.expires_at <= now) {
      throw Object.assign(new Error('lease expired'), { code: 'lease_stale' })
    }
    const expiresAt = now + clampTtlMs(input.ttlMs)
    this.db.prepare(`UPDATE control_leases SET expires_at = ? WHERE lease_id = ?`).run(expiresAt, row.lease_id)
    return {
      leaseId: row.lease_id,
      resource: JSON.parse(row.resource_json) as ResourceRef,
      holderClientId: row.holder_client_id,
      generation: row.generation,
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  /**
   * End whatever lease holds `resource` now, without its holder. The row stays
   * expired, so the next acquire bumps the generation and the old holder's
   * renew and mutating calls fail as stale.
   */
  revoke(resource: ResourceRef): void {
    this.db.prepare(`UPDATE control_leases SET expires_at = 0 WHERE resource_key = ?`).run(resourceKey(resource))
  }

  release(leaseId: string, generation: string, holderClientId: string): void {
    const result = this.db
      .prepare(
        `DELETE FROM control_leases WHERE lease_id = ? AND generation = ? AND holder_client_id = ? AND epoch = ?`,
      )
      .run(leaseId, generation, holderClientId, this.leaseEpoch)
    if (result.changes !== 1) {
      throw Object.assign(new Error('lease release failed'), { code: 'lease_stale' })
    }
  }

  assertValid(input: {
    resource: ResourceRef
    leaseId: string
    generation: string
    holderClientId: string
  }): void {
    const key = resourceKey(input.resource)
    const row = this.db
      .prepare(
        `SELECT lease_id, holder_client_id, generation, expires_at, epoch FROM control_leases WHERE resource_key = ?`,
      )
      .get(key) as
      | {
          lease_id: string
          holder_client_id: string
          generation: string
          expires_at: number
          epoch: string
        }
      | undefined

    if (!row || row.epoch !== this.leaseEpoch) {
      throw Object.assign(new Error('lease required'), { code: 'lease_required' })
    }
    if (row.lease_id !== input.leaseId || row.generation !== input.generation) {
      throw Object.assign(new Error('stale lease generation'), { code: 'lease_stale' })
    }
    if (row.holder_client_id !== input.holderClientId) {
      throw Object.assign(new Error('lease holder mismatch'), { code: 'lease_stale' })
    }
    if (row.expires_at <= Date.now()) {
      throw Object.assign(new Error('lease expired'), { code: 'lease_stale' })
    }
  }
}
