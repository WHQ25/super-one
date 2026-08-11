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

/**
 * Coalesce concurrent enable calls for the same harness (+ forcePin).
 * Prevents double-download of the same partial when the UI double-fires IPC
 * (Strict Mode, double-click race, onboarding + align overlap).
 */
const enableInflight = new Map<string, Promise<HarnessInstallationStatus>>()

/** Throttle download progress IPC (~200ms) — chunk-level emits flood the renderer. */
const PROGRESS_THROTTLE_MS = 200

function enableInflightKey(input: EnableHarnessInput): string {
  return `${input.harnessId}:${input.forcePin === true ? '1' : '0'}`
}

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
  enableInflight.clear()
}

export function listHarnessInstallations(): HarnessInstallationStatus[] {
  return getHarnessManager().list()
}

export function getHarnessInstallation(id: NodeHarnessId): HarnessInstallationStatus {
  return getHarnessManager().get(id)
}

function depsWithProgress(harnessId: NodeHarnessId): HarnessKernelDeps {
  const base = desktopHarnessDeps()
  let lastEmitAt = 0
  const wrapped: ManagedRuntimeInstaller = {
    install(id, home, onProgress) {
      return base.installer.install(id, home, (received, total) => {
        const now = Date.now()
        const done = total > 0 && received >= total
        if (done || lastEmitAt === 0 || now - lastEmitAt >= PROGRESS_THROTTLE_MS) {
          lastEmitAt = now
          progressListener?.({
            harnessId: id,
            received,
            total,
            phase: 'download',
          })
        }
        onProgress?.(received, total)
      })
    },
  }
  return { ...base, installer: wrapped }
}

export async function enableDesktopHarness(
  input: EnableHarnessInput,
): Promise<HarnessInstallationStatus> {
  const key = enableInflightKey(input)
  const existing = enableInflight.get(key)
  if (existing) {
    log.info(`[harness] enable ${input.harnessId} already in flight — joining`)
    return existing
  }

  const run = enableDesktopHarnessOnce(input).finally(() => {
    if (enableInflight.get(key) === run) {
      enableInflight.delete(key)
    }
  })
  enableInflight.set(key, run)
  return run
}

async function enableDesktopHarnessOnce(
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

/**
 * Startup gate: for every **enabled** Claude/Codex row, force SuperOne-managed
 * install at the app pin (skip PATH/bundled autoRuntime). Reuses existing
 * install only when `install-meta` runtimeVersion matches the pin.
 */
export async function alignEnabledManagedHarnesses(): Promise<{
  aligned: Array<{ id: 'claude' | 'codex'; runtimeVersion?: string }>
  failed: Array<{ id: 'claude' | 'codex'; error: string }>
}> {
  const m = getHarnessManager()
  const aligned: Array<{ id: 'claude' | 'codex'; runtimeVersion?: string }> = []
  const failed: Array<{ id: 'claude' | 'codex'; error: string }> = []

  for (const id of ['claude', 'codex'] as const) {
    const row = m.get(id)
    if (!row.enabled) continue
    log.info(`[harness] align enabled ${id} (forcePin)`)
    try {
      m.update(id, { enabled: true, state: 'installing', diagnosticCode: null })
      const status = await enableDesktopHarness({ harnessId: id, forcePin: true })
      aligned.push({ id, runtimeVersion: status.runtimeVersion })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.error(`[harness] align ${id} failed: ${error}`)
      failed.push({ id, error })
    }
  }
  return { aligned, failed }
}
