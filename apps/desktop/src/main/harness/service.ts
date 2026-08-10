/**
 * Desktop harness installation service — singleton HarnessManager + enable API.
 *
 * P2 surface: main-process only. Settings UI / IPC land in P4.
 */

import {
  HarnessManager,
  enableHarness as kernelEnableHarness,
  disableHarness as kernelDisableHarness,
  probeHarnessReadiness,
  type EnableHarnessInput,
} from '@superone/runtime/harness'
import type { TransactionalSqliteDatabase } from '@superone/runtime/sqlite'
import type { HarnessInstallationStatus, NodeHarnessId } from '@superone/shared/environment'

export type { EnableHarnessInput, HarnessInstallationStatus, NodeHarnessId }

import { getDb } from '../database'
import { desktopHarnessDeps, desktopHarnessResolver, desktopHarnessAuthProbe } from './host'
import log from '../logger'

let manager: HarnessManager | null = null

export function getHarnessManager(): HarnessManager {
  if (manager) return manager
  // better-sqlite3 Database satisfies TransactionalSqliteDatabase.
  const db = getDb() as unknown as TransactionalSqliteDatabase
  manager = new HarnessManager(db)
  return manager
}

/** Test / shutdown helper. */
export function resetHarnessManagerForTests(): void {
  manager = null
}

export function listHarnessInstallations(): HarnessInstallationStatus[] {
  return getHarnessManager().list()
}

export function getHarnessInstallation(id: NodeHarnessId): HarnessInstallationStatus {
  return getHarnessManager().get(id)
}

export async function enableDesktopHarness(
  input: EnableHarnessInput,
): Promise<HarnessInstallationStatus> {
  const m = getHarnessManager()
  log.info(`[harness] enable ${input.harnessId}`)
  const status = await kernelEnableHarness(m, input, desktopHarnessDeps())
  log.info(
    `[harness] enable ${input.harnessId} → enabled=${status.enabled} state=${status.state} command=${status.command ?? '-'}`,
  )
  return status
}

export function disableDesktopHarness(id: NodeHarnessId): HarnessInstallationStatus {
  return kernelDisableHarness(getHarnessManager(), id)
}

export function probeDesktopHarness(id: NodeHarnessId) {
  return probeHarnessReadiness(getHarnessManager(), id, {
    resolver: desktopHarnessResolver,
    auth: desktopHarnessAuthProbe(),
  })
}

/**
 * Ensure a managed harness is installed and catalogued.
 * Idempotent: skips the download when autoRuntime or a prior install already works.
 */
export async function ensureManagedHarnessReady(
  id: 'claude' | 'codex',
): Promise<HarnessInstallationStatus> {
  const m = getHarnessManager()
  const current = m.get(id)
  if (
    current.enabled &&
    (current.state === 'ready' || current.state === 'needs_auth') &&
    current.command &&
    desktopHarnessResolver.resolveBinary(id, m)
  ) {
    // Re-probe so needs_auth → ready can promote when credentials appear.
    probeDesktopHarness(id)
    return m.get(id)
  }
  return enableDesktopHarness({ harnessId: id })
}
