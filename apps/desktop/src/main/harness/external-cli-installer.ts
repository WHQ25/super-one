import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  clearExternalCliVersionCache,
  isLegacyAntigravityServerCommand,
  resolveAntigravityCommand,
  resolveExternalCommand,
} from '@superone/runtime/harness'
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
import { clearExternalCliLatestVersionCache } from './external-cli-updates'
import { enableDesktopHarness, getHarnessManager } from './service'

export type ExternalCliInstallListener = (event: ExternalCliInstallEvent) => void

export interface ExternalCliInstallerDeps {
  platform: NodeJS.Platform
  cwd: string
  ensurePath: () => Promise<void>
  refreshPath: () => Promise<void>
  resolveExistingBinary: (harnessId: ExternalCliHarnessId) => string | null
  spawnProcess: (
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; argv0: string },
  ) => ChildProcess
  enableHarness: (harnessId: ExternalCliHarnessId) => Promise<HarnessInstallationStatus>
  refreshAcpAgents: () => Promise<void>
  emit: ExternalCliInstallListener
}

interface SpawnInvocation {
  command: string
  args: string[]
  extraEnv?: Record<string, string | undefined>
  mode: 'install' | 'upgrade'
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

function normalizePathSlashes(filePath: string): string {
  return filePath.replaceAll('\\', '/').toLowerCase()
}

function safeRealpath(filePath: string): string {
  try {
    return realpathSync(filePath)
  } catch {
    return filePath
  }
}

function resolveGrokScriptHome(binaryPath: string): string | null {
  const realPath = safeRealpath(binaryPath)
  const fileName = basename(realPath).toLowerCase()
  const parentDir = dirname(realPath)
  const parentName = basename(parentDir).toLowerCase()
  const candidateHome = dirname(parentDir)
  if (parentName === 'downloads' && fileName.startsWith('grok-')) {
    return candidateHome
  }
  if (
    parentName === 'bin' &&
    (/^grok-\d/.test(fileName) ||
      ((fileName === 'grok' || fileName === 'grok.exe') &&
        existsSync(join(candidateHome, 'downloads'))))
  ) {
    return candidateHome
  }
  return null
}

function resolveOpenCodeCurlHome(binaryPath: string): string | null {
  const check = (candidate: string): string | null => {
    const slashed = candidate.replaceAll('\\', '/')
    const match = /\/\.opencode\/bin\/opencode(?:\.exe)?$/i.exec(slashed)
    if (!match) return null
    return match.index === 0 ? '/' : slashed.slice(0, match.index)
  }
  return check(safeRealpath(binaryPath)) ?? check(binaryPath)
}

function defaultResolveExistingBinary(harnessId: ExternalCliHarnessId): string | null {
  let storedCommand: string | undefined
  try {
    storedCommand = getHarnessManager().get(harnessId).command?.trim()
  } catch {
    storedCommand = undefined
  }
  if (harnessId === 'acp-antigravity') {
    const explicit =
      storedCommand && !isLegacyAntigravityServerCommand(storedCommand)
        ? storedCommand
        : undefined
    return resolveAntigravityCommand(explicit) ?? resolveAntigravityCommand()
  }
  if (harnessId === 'acp-grok') {
    const searchNames =
      process.platform === 'win32' ? ['grok.exe', 'grok.cmd', 'grok'] : ['grok']
    if (storedCommand) {
      const explicit = resolveExternalCommand(storedCommand, [], { preserveSymlinks: true })
      if (explicit) return explicit
    }
    const fromPath = resolveExternalCommand(undefined, searchNames, { preserveSymlinks: true })
    if (fromPath) return fromPath
    const home = homedir()
    for (const dir of [join(home, '.grok', 'bin'), join(home, '.local', 'bin')]) {
      for (const name of searchNames) {
        const hit = resolveExternalCommand(join(dir, name), [], { preserveSymlinks: true })
        if (hit) return hit
      }
    }
    return null
  }
  const searchNames =
    process.platform === 'win32'
      ? ['opencode.exe', 'opencode.cmd', 'opencode']
      : ['opencode']
  if (storedCommand) {
    const explicit = resolveExternalCommand(storedCommand, [])
    if (explicit) return explicit
  }
  const fromPath = resolveExternalCommand(undefined, searchNames)
  if (fromPath) return fromPath
  const home = homedir()
  for (const dir of [join(home, '.opencode', 'bin'), join(home, '.local', 'bin')]) {
    for (const name of searchNames) {
      const hit = resolveExternalCommand(join(dir, name), [])
      if (hit) return hit
    }
  }
  return null
}

function buildSpawnInvocation(
  harnessId: ExternalCliHarnessId,
  platform: NodeJS.Platform,
  existingBinary: string | null,
): SpawnInvocation {
  if (existingBinary) {
    if (harnessId === 'acp-antigravity') {
      return {
        command: existingBinary,
        args: ['update'],
        mode: 'upgrade',
      }
    }
    if (harnessId === 'acp-grok') {
      const grokHome = resolveGrokScriptHome(existingBinary)
      return {
        command: existingBinary,
        args: ['update'],
        extraEnv: {
          ...(grokHome ? { GROK_HOME: grokHome } : {}),
          npm_config_allow_scripts: '@xai-official/grok',
          npm_config_user_agent: undefined,
        },
        mode: 'upgrade',
      }
    }
    const normalized = normalizePathSlashes(existingBinary)
    const curlHome = resolveOpenCodeCurlHome(existingBinary)
    const isCurlInstall =
      Boolean(curlHome) ||
      normalized.endsWith('/.opencode/bin/opencode') ||
      normalized.endsWith('/.opencode/bin/opencode.exe')
    return {
      command: existingBinary,
      args: isCurlInstall ? ['upgrade', '--method', 'curl'] : ['upgrade'],
      ...(curlHome ? { extraEnv: { HOME: curlHome } } : {}),
      mode: 'upgrade',
    }
  }

  const spec = getExternalCliInstallSpec(harnessId, platform)
  const isWin = platform === 'win32'
  return {
    command: isWin ? 'powershell' : 'bash',
    args: isWin ? ['-NoProfile', '-Command', spec.command] : ['-c', spec.command],
    mode: 'install',
  }
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
    resolveExistingBinary: defaultResolveExistingBinary,
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
  const existingBinary = deps.resolveExistingBinary(harnessId)
  const invocation = buildSpawnInvocation(harnessId, deps.platform, existingBinary)

  log.info(
    '[harness-cli-install] starting %s (%s: %s %s)',
    harnessId,
    invocation.mode,
    invocation.command,
    invocation.args.join(' '),
  )
  deps.emit({ harnessId, phase: 'start' })

  const env = buildSafeEnv({
    TERM: 'xterm-256color',
    FORCE_COLOR: '1',
    CLICOLOR_FORCE: '1',
  })
  if (invocation.extraEnv) {
    for (const [key, value] of Object.entries(invocation.extraEnv)) {
      if (value === undefined) delete env[key]
      else env[key] = value
    }
  }

  return new Promise<ExternalCliInstallResult>((resolve) => {
    let settled = false
    let child: ChildProcess

    try {
      child = deps.spawnProcess(invocation.command, invocation.args, {
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
          clearExternalCliVersionCache()
          clearExternalCliLatestVersionCache(harnessId)
          const status = await deps.enableHarness(harnessId)
          await deps.refreshAcpAgents()
          if (status.state === 'missing' || status.state === 'incompatible') {
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
