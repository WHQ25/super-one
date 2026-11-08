import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import type { HarnessInstallationStatus } from '@superone/shared/environment'
import { resolveExternalCommand, sanitizeHarnessArgs } from './enable'
import type { HarnessManager } from './manager'
import type { HarnessCatalogReader } from './types'

export interface AntigravityResolvedRuntime {
  command: string
  /** Alias for `command` kept for caller compatibility. */
  executablePath: string
  args: string[]
  source: 'path' | 'explicit'
}

export function antigravityExecutableSearchNames(
  platform: NodeJS.Platform = process.platform,
): string[] {
  return platform === 'win32' ? ['agy.exe', 'agy.cmd', 'agy'] : ['agy']
}

export function antigravityKnownBinDirs(
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
  localAppData: string | undefined = process.env.LOCALAPPDATA,
): string[] {
  if (platform === 'win32') {
    const appDataDir = localAppData?.trim()
      ? join(localAppData.trim(), 'agy', 'bin')
      : join(home, 'AppData', 'Local', 'agy', 'bin')
    return [appDataDir, join(home, '.local', 'bin'), join(home, '.antigravity_cli', 'bin')]
  }
  return [join(home, '.local', 'bin'), join(home, '.antigravity_cli', 'bin')]
}

export function isLegacyAntigravityServerCommand(command: string | undefined | null): boolean {
  if (!command || typeof command !== 'string') return false
  const base = basename(command.trim().replace(/\\/g, '/')).toLowerCase()
  return base === 'agy_acp_server' || base.startsWith('agy_acp_server.')
}

function isLegacyAntigravityDefaultArgs(args: readonly string[] | undefined): boolean {
  if (!args || args.length === 0) return true
  return args.length === 1 && args[0] === '--uid='
}

export function resolveAntigravityCommand(
  explicit?: string,
  options: {
    preserveSymlinks?: boolean
    pathEnv?: string
    homeDir?: string
    platform?: NodeJS.Platform
    localAppData?: string
  } = {},
): string | null {
  const platform = options.platform ?? process.platform
  const home = options.homeDir ?? homedir()
  const preserveSymlinks = options.preserveSymlinks ?? true
  const trimmed = explicit?.trim()
  if (trimmed && !isLegacyAntigravityServerCommand(trimmed)) {
    const bareCommand =
      !trimmed.includes('/') && !trimmed.includes('\\') && !isAbsolute(trimmed)
    let command = resolveExternalCommand(
      bareCommand ? undefined : trimmed,
      [bareCommand ? trimmed : 'agy'],
      { preserveSymlinks, pathEnv: options.pathEnv },
    )
    if (
      !command &&
      bareCommand &&
      (trimmed === 'agy' || trimmed === 'agy.exe' || trimmed === 'agy.cmd')
    ) {
      for (const dir of antigravityKnownBinDirs(home, platform, options.localAppData)) {
        for (const name of antigravityExecutableSearchNames(platform)) {
          command = resolveExternalCommand(join(dir, name), [], { preserveSymlinks })
          if (command) break
        }
        if (command) break
      }
    }
    return command
  }

  const searchNames = antigravityExecutableSearchNames(platform)
  let command = resolveExternalCommand(undefined, searchNames, {
    preserveSymlinks,
    pathEnv: options.pathEnv,
  })
  if (!command) {
    for (const dir of antigravityKnownBinDirs(home, platform, options.localAppData)) {
      for (const name of searchNames) {
        command = resolveExternalCommand(join(dir, name), [], { preserveSymlinks })
        if (command) break
      }
      if (command) break
    }
  }
  return command
}

export interface ResolveAntigravityRuntimeOptions {
  homeRoot?: string
  homeDir?: string
  platform?: NodeJS.Platform
  override?: { command?: string; args?: string[]; env?: Record<string, string> }
  command?: string
  args?: string[]
  env?: Record<string, string>
}

/** One resolution policy for settings, readiness, chat, and account login. */
export function resolveAntigravityRuntime(
  catalog: HarnessCatalogReader,
  opts?: ResolveAntigravityRuntimeOptions,
): AntigravityResolvedRuntime | null {
  const status = catalog.get('acp-antigravity')
  if (!status.enabled) return null
  const override =
    opts && ('override' in opts || 'homeRoot' in opts || 'platform' in opts || 'homeDir' in opts)
      ? opts.override
      : (opts as { command?: string; args?: string[]; env?: Record<string, string> } | undefined)
  const platform = opts?.platform ?? process.platform
  const homeDir = opts?.homeDir ?? homedir()

  const config = catalog.getExternalLaunchConfig?.('acp-antigravity') ?? {}
  const saved = config.command ?? status.command
  const isLegacySaved = isLegacyAntigravityServerCommand(saved)
  const configured =
    config.commandSource === 'path' || isLegacySaved ? undefined : saved?.trim()

  const rawOverrideCmd = override?.command?.trim()
  const overrideCmd =
    rawOverrideCmd && !isLegacyAntigravityServerCommand(rawOverrideCmd) && rawOverrideCmd !== 'agy'
      ? rawOverrideCmd
      : undefined

  const explicit =
    overrideCmd ||
    override?.env?.SUPERONE_ANTIGRAVITY_BINARY?.trim() ||
    process.env.SUPERONE_ANTIGRAVITY_BINARY?.trim() ||
    configured

  const command = resolveAntigravityCommand(explicit, {
    preserveSymlinks: true,
    pathEnv: override?.env?.PATH,
    homeDir,
    platform,
  })
  if (!command) return null

  const overrideArgs =
    override?.args && !isLegacyAntigravityDefaultArgs(override.args)
      ? override.args
      : undefined
  const configArgs =
    config.args && !isLegacyAntigravityDefaultArgs(config.args) ? config.args : undefined
  const args = overrideArgs ?? configArgs ?? ['acp']

  return {
    command,
    executablePath: command,
    args,
    source: explicit ? 'explicit' : 'path',
  }
}

export function enableAcpAntigravity(
  manager: HarnessManager,
  opts: { command?: string; args: string[] },
): HarnessInstallationStatus {
  const defaultArgs = ['acp']
  const args = sanitizeHarnessArgs(
    opts.args.length > 0 && !isLegacyAntigravityDefaultArgs(opts.args)
      ? opts.args
      : defaultArgs,
  )
  const explicitCmd =
    opts.command?.trim() && !isLegacyAntigravityServerCommand(opts.command)
      ? opts.command.trim()
      : undefined
  const resolved = resolveAntigravityCommand(explicitCmd, { preserveSymlinks: true })
  if (!resolved) {
    return manager.update('acp-antigravity', {
      enabled: true,
      state: 'missing',
      command: null,
      runtimeVersion: null,
      diagnosticCode: 'not_found',
      lastProbedAt: Date.now(),
      configJson: JSON.stringify({
        commandSource: explicitCmd ? 'explicit' : 'path',
        command: explicitCmd,
        args,
        usesDefaultArgs: opts.args.length === 0,
      }),
    })
  }
  return manager.update('acp-antigravity', {
    enabled: true,
    state: 'ready',
    command: resolved,
    runtimeVersion: null,
    diagnosticCode: null,
    diagnosticFields: null,
    lastProbedAt: Date.now(),
    configJson: JSON.stringify({
      command: resolved,
      commandSource: explicitCmd ? 'explicit' : 'path',
      args,
      usesDefaultArgs: opts.args.length === 0,
    }),
  })
}
