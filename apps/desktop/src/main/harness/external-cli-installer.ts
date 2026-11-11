import { spawn, type ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'
import {
  getExternalCliInstallSpec,
  isExternalCliHarnessId,
  type ExternalCliHarnessId,
  type ExternalCliInstallEvent,
  type ExternalCliInstallResult,
  type HarnessInstallationStatus,
} from '@superone/shared/environment'
import log from '../logger'
import { ProcessTitle } from '../process-titles'
import { ensureShellPath, refreshShellPath } from '../shell-path'
import { buildSafeEnv } from '../spawn-env'
import { enableDesktopHarness, getHarnessManager } from './service'

export type ExternalCliInstallListener = (event: ExternalCliInstallEvent) => void

export interface ExternalCliInstallerDeps {
  platform: NodeJS.Platform
  cwd: string
  ensurePath: () => Promise<void>
  refreshPath: () => Promise<void>
  spawnProcess: (
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; argv0: string },
  ) => ChildProcess
  enableHarness: (harnessId: ExternalCliHarnessId) => Promise<HarnessInstallationStatus>
  refreshAcpAgents: () => Promise<void>
  emit: ExternalCliInstallListener
}

let installListener: ExternalCliInstallListener | null = null
const inflightInstalls = new Map<ExternalCliHarnessId, Promise<ExternalCliInstallResult>>()

export function setExternalCliInstallListener(
  listener: ExternalCliInstallListener | null,
): void {
  installListener = listener
}

export function resetExternalCliInstallerForTests(): void {
  installListener = null
  inflightInstalls.clear()
}

async function defaultEnableAfterInstall(
  harnessId: ExternalCliHarnessId,
): Promise<HarnessInstallationStatus> {
  const existingArgs =
    harnessId === 'acp-grok' || harnessId === 'acp-antigravity'
      ? getHarnessManager().getExternalLaunchConfig(harnessId).args
      : undefined
  return enableDesktopHarness({
    harnessId,
    ...(existingArgs && existingArgs.length > 0 ? { args: existingArgs } : {}),
  })
}

async function defaultRefreshAcpAgents(): Promise<void> {
  try {
    const { refreshAcpDetectedAgents } = await import('../acp/acp-model-cache')
    await refreshAcpDetectedAgents()
  } catch (err) {
    log.warn('[harness-cli-install] refreshAcpDetectedAgents failed:', err)
  }
}

function defaultDeps(): ExternalCliInstallerDeps {
  return {
    platform: process.platform,
    cwd: homedir(),
    ensurePath: ensureShellPath,
    refreshPath: refreshShellPath,
    spawnProcess: (command, args, options) => spawn(command, args, options),
    enableHarness: defaultEnableAfterInstall,
    refreshAcpAgents: defaultRefreshAcpAgents,
    emit: (event) => installListener?.(event),
  }
}

export async function installExternalHarnessCli(
  harnessId: string,
  overrides?: Partial<ExternalCliInstallerDeps>,
): Promise<ExternalCliInstallResult> {
  if (!isExternalCliHarnessId(harnessId)) {
    throw new Error(`unsupported external CLI harness: ${harnessId}`)
  }

  const existing = inflightInstalls.get(harnessId)
  if (existing) return existing

  const deps: ExternalCliInstallerDeps = { ...defaultDeps(), ...overrides }
  const run = runExternalCliInstallOnce(harnessId, deps).finally(() => {
    if (inflightInstalls.get(harnessId) === run) {
      inflightInstalls.delete(harnessId)
    }
  })
  inflightInstalls.set(harnessId, run)
  return run
}

async function runExternalCliInstallOnce(
  harnessId: ExternalCliHarnessId,
  deps: ExternalCliInstallerDeps,
): Promise<ExternalCliInstallResult> {
  await deps.ensurePath()
  const spec = getExternalCliInstallSpec(harnessId, deps.platform)
  const isWin = deps.platform === 'win32'
  const shellBin = isWin ? 'powershell' : 'bash'
  const shellArgs = isWin
    ? ['-NoProfile', '-Command', spec.command]
    : ['-c', spec.command]

  log.info('[harness-cli-install] starting %s (%s)', harnessId, spec.binaryName)
  deps.emit({ harnessId, phase: 'start' })

  const env = buildSafeEnv({
    TERM: 'xterm-256color',
    FORCE_COLOR: '1',
    CLICOLOR_FORCE: '1',
  })

  return new Promise<ExternalCliInstallResult>((resolve) => {
    let settled = false
    let child: ChildProcess

    try {
      child = deps.spawnProcess(shellBin, shellArgs, {
        cwd: deps.cwd,
        env,
        argv0: ProcessTitle.Installer,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      settled = true
      deps.emit({ harnessId, phase: 'error', exitCode: 1, message })
      resolve({ ok: false, harnessId, exitCode: 1, message })
      return
    }

    child.stdin?.end()

    child.stdout?.on('data', (chunk: Buffer | string) => {
      deps.emit({ harnessId, phase: 'output', data: chunk.toString() })
    })

    child.stderr?.on('data', (chunk: Buffer | string) => {
      deps.emit({ harnessId, phase: 'output', data: chunk.toString() })
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      log.error('[harness-cli-install] spawn error for %s: %s', harnessId, err.message)
      deps.emit({ harnessId, phase: 'error', exitCode: 1, message: err.message })
      resolve({ ok: false, harnessId, exitCode: 1, message: err.message })
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      const exitCode = code ?? 1
      void (async () => {
        try {
          await deps.refreshPath()
          if (exitCode !== 0) {
            log.warn('[harness-cli-install] %s exited with code %d', harnessId, exitCode)
            deps.emit({ harnessId, phase: 'error', exitCode })
            resolve({ ok: false, harnessId, exitCode })
            return
          }
          const status = await deps.enableHarness(harnessId)
          await deps.refreshAcpAgents()
          if (status.state === 'missing') {
            const message = status.diagnostic?.message
            deps.emit({ harnessId, phase: 'error', exitCode: 0, message })
            resolve({ ok: false, harnessId, exitCode: 0, message, status })
            return
          }
          deps.emit({ harnessId, phase: 'done', exitCode: 0 })
          resolve({ ok: true, harnessId, exitCode: 0, status })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          log.error('[harness-cli-install] post-install failed for %s: %s', harnessId, message)
          deps.emit({ harnessId, phase: 'error', exitCode, message })
          resolve({ ok: false, harnessId, exitCode, message })
        }
      })()
    })
  })
}
