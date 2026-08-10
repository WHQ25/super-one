/**
 * Desktop harness installation service — singleton HarnessManager + enable API.
 */

import {
  HarnessManager,
  enableHarness as kernelEnableHarness,
  disableHarness as kernelDisableHarness,
  probeHarnessReadiness,
  type EnableHarnessInput,
  type HarnessKernelDeps,
  type ManagedRuntimeInstaller,
} from '@superone/runtime/harness'
import type { TransactionalSqliteDatabase } from '@superone/runtime/sqlite'
import type { HarnessInstallationStatus, NodeHarnessId } from '@superone/shared/environment'

export type { EnableHarnessInput, HarnessInstallationStatus, NodeHarnessId }

import { getDb } from '../database'
import { desktopHarnessDeps, desktopHarnessResolver, desktopHarnessAuthProbe } from './host'
import log from '../logger'

let manager: HarnessManager | null = null

export type HarnessInstallProgressEvent = {
  harnessId: NodeHarnessId
  received: number
  total: number
  phase: 'download' | 'done' | 'error'
  message?: string
}

type ProgressListener = (event: HarnessInstallProgressEvent) => void
let progressListener: ProgressListener | null = null

/** Main registers a push to the renderer; null clears. */
export function setHarnessInstallProgressListener(fn: ProgressListener | null): void {
  progressListener = fn
}

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
  progressListener = null
}

export function listHarnessInstallations(): HarnessInstallationStatus[] {
  return getHarnessManager().list()
}

export function getHarnessInstallation(id: NodeHarnessId): HarnessInstallationStatus {
  return getHarnessManager().get(id)
}

function depsWithProgress(harnessId: NodeHarnessId): HarnessKernelDeps {
  const base = desktopHarnessDeps()
  const wrapped: ManagedRuntimeInstaller = {
    install(id, home, onProgress) {
      return base.installer.install(id, home, (received, total) => {
        progressListener?.({
          harnessId: id,
          received,
          total,
          phase: 'download',
        })
        onProgress?.(received, total)
      })
    },
  }
  return { ...base, installer: wrapped }
}

export async function enableDesktopHarness(
  input: EnableHarnessInput,
): Promise<HarnessInstallationStatus> {
  const m = getHarnessManager()
  const id = input.harnessId
  log.info(`[harness] enable ${id}`)
  try {
    // Mark installing for managed downloads so the UI can show progress immediately.
    if (id === 'claude' || id === 'codex') {
      const cur = m.get(id)
      if (!cur.command || cur.state === 'disabled' || cur.state === 'missing' || cur.state === 'error') {
        m.update(id, { enabled: true, state: 'installing', diagnosticCode: null })
      }
    }
    const status = await kernelEnableHarness(m, input, depsWithProgress(id))
    progressListener?.({
      harnessId: id,
      received: 1,
      total: 1,
      phase: 'done',
    })
    log.info(
      `[harness] enable ${id} → enabled=${status.enabled} state=${status.state} command=${status.command ?? '-'}`,
    )
    return status
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    progressListener?.({
      harnessId: id,
      received: 0,
      total: 0,
      phase: 'error',
      message,
    })
    try {
      m.update(id, {
        enabled: true,
        state: 'error',
        diagnosticCode: 'error',
      })
    } catch {
      /* catalog update best-effort */
    }
    throw err
  }
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
