/**
 * Persistent Harness installation catalog for the node.
 *
 * Defaults: all first-party harnesses disabled. Descriptor harnessIds come only
 * from enabled+ready rows. Simulated test readiness is an **in-memory overlay**
 * that never writes durable rows (production restart of the same node home
 * remains fail-closed).
 *
 * Public diagnostics are allowlisted codes + authored templates only. Free-form
 * provider/subprocess error strings are never accepted, persisted, or returned.
 */

import {
  NODE_HARNESS_DEFINITIONS,
  buildHarnessDiagnostic,
  defaultHarnessInstallationStatus,
  isHarnessRunnable,
  isNodeHarnessId,
  normalizeSessionHarnessId,
  readySessionHarnessIds,
  sanitizeHarnessCommand,
  sanitizeHarnessDiagnosticCode,
  type HarnessDiagnosticCode,
  type HarnessDiagnosticFields,
  type HarnessInstallState,
  type HarnessInstallationStatus,
  type NodeHarnessId,
} from '@superone/shared/environment'
import type { HarnessId } from '@superone/shared/session-types'
import type { TransactionalSqliteDatabase } from '../sqlite'

export interface HarnessConfigPatch {
  enabled?: boolean
  state?: HarnessInstallState
  runtimeVersion?: string | null
  command?: string | null
  /**
   * Allowlisted diagnostic code only. Message is always derived from the
   * authored template — never pass raw error strings.
   */
  diagnosticCode?: HarnessDiagnosticCode | null
  /** Optional non-secret detail fields for the diagnostic template. */
  diagnosticFields?: HarnessDiagnosticFields | null
  configJson?: string | null
  /** Opaque secret reference key in the node secret store (never the secret). */
  secretRef?: string | null
  lastProbedAt?: number | null
}

export class HarnessManager {
  /**
   * When true, list/get/ready behave as if every harness is enabled+ready.
   * Never persisted — only for contract/CI simulated runners.
   */
  private simulatedOverlay = false

  constructor(private readonly db: TransactionalSqliteDatabase) {
    this.ensureRows()
    // Defense in depth: purge any rows previously contaminated by older code
    // that persisted simulated readiness into the durable catalog.
    this.clearSimulatedContamination()
  }

  /** Ensure one row per first-party definition. */
  private ensureRows(): void {
    const now = Date.now()
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO harness_installations
        (harness_id, enabled, state, runtime_version, command, config_json, secret_ref,
         diagnostic_code, diagnostic_message, last_probed_at, updated_at)
       VALUES (?, 0, 'disabled', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
    )
    const tx = this.db.transaction(() => {
      for (const def of NODE_HARNESS_DEFINITIONS) {
        insert.run(def.id, now)
      }
    })
    tx()
  }

  /**
   * Reset durable rows that older builds may have marked as simulated-ready.
   * Safe to run on every open: only touches synthetic simulated provenance.
   */
  private clearSimulatedContamination(): void {
    const now = Date.now()
    this.db
      .prepare(
        `UPDATE harness_installations SET
           enabled = 0,
           state = 'disabled',
           runtime_version = NULL,
           command = NULL,
           diagnostic_code = NULL,
           diagnostic_message = NULL,
           last_probed_at = NULL,
           updated_at = ?
         WHERE runtime_version = 'simulated'
            OR diagnostic_code = 'simulated'`,
      )
      .run(now)
  }

  /**
   * Enable in-memory simulated readiness for all first-party harnesses.
   * Does not write the database. Production starts must never call this.
   */
  enableSimulatedOverlay(): void {
    this.simulatedOverlay = true
  }

  /** @deprecated use enableSimulatedOverlay — kept as alias for call-site clarity. */
  markAllSimulatedReady(): void {
    this.enableSimulatedOverlay()
  }

  list(): HarnessInstallationStatus[] {
    return NODE_HARNESS_DEFINITIONS.map((d) => this.get(d.id))
  }

  get(id: NodeHarnessId): HarnessInstallationStatus {
    const status = this.readPersisted(id)
    if (!this.simulatedOverlay) return status
    return {
      ...status,
      enabled: true,
      state: 'ready',
      runtimeVersion: status.runtimeVersion ?? 'simulated',
      diagnostic: buildHarnessDiagnostic('simulated'),
    }
  }

  private readPersisted(id: NodeHarnessId): HarnessInstallationStatus {
    const row = this.db
      .prepare(
        `SELECT harness_id, enabled, state, runtime_version, command,
                diagnostic_code, diagnostic_message
         FROM harness_installations WHERE harness_id = ?`,
      )
      .get(id) as
      | {
          harness_id: string
          enabled: number
          state: string
          runtime_version: string | null
          command: string | null
          diagnostic_code: string | null
          diagnostic_message: string | null
        }
      | undefined

    if (!row) {
      return defaultHarnessInstallationStatus(id)
    }

    const def = NODE_HARNESS_DEFINITIONS.find((d) => d.id === id)!
    const status: HarnessInstallationStatus = {
      id,
      runtimeSource: def.runtimeSource,
      enabled: row.enabled === 1,
      state: parseState(row.state),
      requiresAuth: def.requiresAuth,
    }
    if (row.runtime_version && row.runtime_version !== 'simulated') {
      status.runtimeVersion = row.runtime_version
    }
    const command = sanitizeHarnessCommand(row.command)
    if (command) status.command = command

    // Rebuild message from allowlisted code only — never trust stored free-form text.
    const code = sanitizeHarnessDiagnosticCode(row.diagnostic_code)
    if (code && code !== 'simulated') {
      status.diagnostic = buildHarnessDiagnostic(code, {
        runtimeVersion: status.runtimeVersion,
        command: status.command,
      })
    }
    return status
  }

  /**
   * Session wire harness ids that are currently runnable (enabled + ready).
   * Used by environment.descriptor capabilities.harnessIds.
   */
  readySessionHarnessIds(): HarnessId[] {
    return readySessionHarnessIds(this.list())
  }

  /** Whether a session.create harnessId is allowed on this node. */
  isSessionHarnessRunnable(sessionHarnessId: string): boolean {
    const wire = normalizeSessionHarnessId(sessionHarnessId)
    if (!wire) return false
    // Catalog lookup uses node id (acp → acp-grok).
    const catalogId = wire === 'acp' ? 'acp-grok' : wire
    if (!isNodeHarnessId(catalogId)) return false
    return isHarnessRunnable(this.get(catalogId))
  }

  update(id: NodeHarnessId, patch: HarnessConfigPatch): HarnessInstallationStatus {
    if (!isNodeHarnessId(id)) {
      throw new Error(`unknown harness: ${id}`)
    }

    const apply = this.db.transaction(() => {
      const current = this.readPersisted(id)
      const extra = this.db
        .prepare(
          `SELECT config_json, secret_ref, last_probed_at, diagnostic_code
           FROM harness_installations WHERE harness_id = ?`,
        )
        .get(id) as
        | {
            config_json: string | null
            secret_ref: string | null
            last_probed_at: number | null
            diagnostic_code: string | null
          }
        | undefined

      const enabled = patch.enabled ?? current.enabled
      const state = patch.state ?? current.state
      const runtimeVersion =
        patch.runtimeVersion === null
          ? null
          : (patch.runtimeVersion ?? current.runtimeVersion ?? null)

      let command: string | null
      if (patch.command === null) {
        command = null
      } else if (patch.command !== undefined) {
        command = sanitizeHarnessCommand(patch.command) ?? null
      } else {
        command = current.command ?? null
      }

      let diagnosticCode: string | null
      if (patch.diagnosticCode === null) {
        diagnosticCode = null
      } else if (patch.diagnosticCode !== undefined) {
        diagnosticCode = sanitizeHarnessDiagnosticCode(patch.diagnosticCode)
      } else {
        diagnosticCode = sanitizeHarnessDiagnosticCode(extra?.diagnostic_code)
      }

      // Always derive the stored message from the allowlisted template.
      // Never persist free-form provider/subprocess error text.
      let diagnosticMessage: string | null = null
      if (diagnosticCode) {
        const fields: HarnessDiagnosticFields = {
          ...(patch.diagnosticFields ?? {}),
          runtimeVersion: runtimeVersion ?? undefined,
          command: command ?? undefined,
        }
        diagnosticMessage = buildHarnessDiagnostic(
          diagnosticCode as HarnessDiagnosticCode,
          fields,
        ).message
      }

      const configJson =
        patch.configJson === null ? null : (patch.configJson ?? extra?.config_json ?? null)
      const secretRef =
        patch.secretRef === null ? null : (patch.secretRef ?? extra?.secret_ref ?? null)
      const lastProbedAt =
        patch.lastProbedAt === null ? null : (patch.lastProbedAt ?? extra?.last_probed_at ?? null)

      const now = Date.now()
      this.db
        .prepare(
          `UPDATE harness_installations SET
             enabled = ?, state = ?, runtime_version = ?, command = ?,
             config_json = ?, secret_ref = ?,
             diagnostic_code = ?, diagnostic_message = ?,
             last_probed_at = ?, updated_at = ?
           WHERE harness_id = ?`,
        )
        .run(
          enabled ? 1 : 0,
          state,
          runtimeVersion,
          command,
          configJson,
          secretRef,
          diagnosticCode,
          diagnosticMessage,
          lastProbedAt,
          now,
          id,
        )
    })
    apply()

    return this.get(id)
  }

  /**
   * Disable a harness. Does not delete managed artifacts or external binaries.
   * Default drain policy is enforced by higher-level CLI/RPC in a later slice.
   */
  disable(id: NodeHarnessId): HarnessInstallationStatus {
    return this.update(id, {
      enabled: false,
      state: 'disabled',
      diagnosticCode: null,
      diagnosticFields: null,
    })
  }

  /**
   * Internal non-secret row fields for CLI show/doctor.
   * Does not expose secret_ref or stored diagnostic message text.
   */
  readRawRow(id: NodeHarnessId): {
    config_json: string | null
    last_probed_at: number | null
  } | null {
    const row = this.db
      .prepare(
        `SELECT config_json, last_probed_at
         FROM harness_installations WHERE harness_id = ?`,
      )
      .get(id) as { config_json: string | null; last_probed_at: number | null } | undefined
    return row ?? null
  }
}

function parseState(raw: string): HarnessInstallState {
  switch (raw) {
    case 'disabled':
    case 'missing':
    case 'installing':
    case 'needs_auth':
    case 'ready':
    case 'incompatible':
    case 'error':
      return raw
    default:
      return 'error'
  }
}
