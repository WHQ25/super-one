/**
 * Public `superone harness …` command group (design §13.5).
 *
 * Stage 2 scope:
 * - list / show / enable / disable / configure / doctor / probe / repair
 * - Public commands omit --home; data dir is $HOME/.superone/node
 *   (tests may set SUPERONE_NODE_HOME).
 * - Managed artifact download/signature is deferred: enable claude|codex
 *   requires --artifact for now, installs to needs_auth after path checks.
 * - External enable probes regular-file + executable; configure is transactional.
 * - Public JSON never includes free-form secrets, URL userinfo, or raw --arg values.
 *
 * Deferred (explicitly rejected if passed): --env-file, --server-password-stdin,
 * --clear-server-password, --clear-env, --startup-timeout, --initialize-timeout,
 * signed manifest download without --artifact.
 */

import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { homedir } from 'node:os'
import {
  NODE_HARNESS_DEFINITIONS,
  getNodeHarnessDefinition,
  isNodeHarnessId,
  type HarnessInstallationStatus,
  type NodeHarnessId,
} from '@superone/shared/environment'
import { resolveNodeHome, nodePaths } from '../config'
import { openNodeDatabase } from '../db/database'
import { HarnessManager } from './harness-manager'
import { probeHarnessReadiness } from './harness-runtime-ready'
import { ProviderStore } from '../provider/provider-store'
import {
  currentCliVersion,
  describeExpectedArtifact,
  installManagedArtifactFromFile,
  isManagedHarnessId,
  loadHarnessReleaseManifest,
  requiredRuntimeVersion,
} from './managed-harness-release'
import type { NodeDatabase } from '../db/database'

export interface HarnessCliResult {
  ok: boolean
  exitCode: number
  /** Stable JSON payload when --json or machine output. */
  json: unknown
  /** Human lines when not --json. */
  text: string
}

export interface HarnessShowDetail extends HarnessInstallationStatus {
  lastProbedAt: number | null
  installationPath: string | null
  /** Allowlisted non-secret configuration summary only. */
  configSummary: Record<string, unknown> | null
  /** CLI-manifest required runtime version for managed harnesses, when known. */
  requiredRuntimeVersion: string | null
}

/** Flags documented in §13.5 but not implemented in Stage 2. */
const DEFERRED_FLAGS = new Set([
  '--env-file',
  '--server-password-stdin',
  '--clear-server-password',
  '--clear-env',
  '--startup-timeout',
  '--initialize-timeout',
])

export function harnessUsage(): string {
  return `Usage: superone harness <command> [options]

Commands:
  list [--json]
  show <HARNESS_ID> [--json]
  enable claude|codex --artifact <FILE> [--json]
  enable opencode [--command <ABS_PATH> | --server-url <URL>] [--json]
  enable acp-grok [--command <ABS_PATH>] [--arg <VALUE>|--arg=<VALUE>]... [--json]
  configure opencode [--command <ABS_PATH> | --server-url <URL>] [--json]
  configure acp-grok [--command <ABS_PATH>] [--arg <VALUE>|--arg=<VALUE>]... [--default-args] [--json]
  disable <HARNESS_ID> [--drain wait|cancel] [--timeout <DURATION>] [--json]
  doctor [<HARNESS_ID>] [--json]
  probe <HARNESS_ID> [--json]
  repair claude|codex --artifact <FILE> [--json]

Notes:
  Operates on $HOME/.superone/node (override only via SUPERONE_NODE_HOME for tests).
  No public --home / --data-dir.
  Stage 2 deferred (rejected if passed): --env-file, --server-password-stdin,
  --clear-server-password, --clear-env, --startup-timeout, --initialize-timeout,
  managed download without --artifact.
`
}

function subUsage(sub: string): string {
  switch (sub) {
    case 'list':
      return 'Usage: superone harness list [--json]'
    case 'show':
      return 'Usage: superone harness show <HARNESS_ID> [--json]'
    case 'enable':
      return `Usage:
  superone harness enable claude|codex --artifact <FILE> [--json]
  superone harness enable opencode [--command <ABS_PATH> | --server-url <URL>] [--json]
  superone harness enable acp-grok [--command <ABS_PATH>] [--arg <VALUE>]... [--json]`
    case 'configure':
      return `Usage:
  superone harness configure opencode [--command <ABS_PATH> | --server-url <URL>] [--json]
  superone harness configure acp-grok [--command <ABS_PATH>] [--arg <VALUE>]... [--default-args] [--json]`
    case 'disable':
      return 'Usage: superone harness disable <HARNESS_ID> [--drain wait|cancel] [--timeout <DURATION>] [--json]'
    case 'doctor':
      return 'Usage: superone harness doctor [<HARNESS_ID>] [--json]'
    case 'probe':
      return 'Usage: superone harness probe <HARNESS_ID> [--json]'
    case 'repair':
      return 'Usage: superone harness repair claude|codex --artifact <FILE> [--json]'
    default:
      return harnessUsage()
  }
}

export async function runHarnessCli(argv: string[]): Promise<HarnessCliResult> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    return { ok: true, exitCode: 0, json: null, text: harnessUsage() }
  }

  const sub = argv[0]!
  const rest = argv.slice(1)

  // Subcommand help before opening the database.
  if (rest.includes('--help') || rest.includes('-h')) {
    return { ok: true, exitCode: 0, json: null, text: subUsage(sub) }
  }

  const known = new Set([
    'list',
    'show',
    'enable',
    'configure',
    'disable',
    'doctor',
    'probe',
    'repair',
  ])
  if (!known.has(sub)) {
    return fail(`unknown harness command: ${sub}\n\n${harnessUsage()}`, rest.includes('--json'))
  }

  const nodeHome = resolveNodeHome(undefined)
  const db = openNodeDatabase(nodePaths(nodeHome).stateDb)
  try {
    const manager = new HarnessManager(db)
    switch (sub) {
      case 'list':
        return cmdList(manager, rest)
      case 'show':
        return cmdShow(manager, rest)
      case 'enable':
        return await cmdEnable(manager, rest, /*configure*/ false)
      case 'configure':
        return await cmdEnable(manager, rest, /*configure*/ true)
      case 'disable':
        return cmdDisable(manager, rest)
      case 'doctor':
        return cmdDoctor(manager, rest)
      case 'probe':
        return cmdProbe(manager, rest, db)
      case 'repair':
        return await cmdRepair(manager, rest)
      default:
        return fail(`unknown harness command: ${sub}`, false)
    }
  } finally {
    db.close()
  }
}

function cmdList(manager: HarnessManager, args: string[]): HarnessCliResult {
  const parsed = parseFlags(args, {
    positionals: 0,
    flags: new Set(['--json']),
    valueFlags: new Set(),
  })
  if (!parsed.ok) return fail(parsed.error, parsed.json)
  return formatList(manager.list(), parsed.json)
}

function cmdShow(manager: HarnessManager, args: string[]): HarnessCliResult {
  const parsed = parseFlags(args, {
    positionals: 1,
    flags: new Set(['--json']),
    valueFlags: new Set(),
  })
  if (!parsed.ok) return fail(parsed.error, parsed.json)
  const id = parsed.positionals[0]
  if (!id || !isNodeHarnessId(id)) {
    return fail(`unknown or missing harness id: ${id ?? '(none)'}`, parsed.json)
  }
  return formatShow(getShowDetail(manager, id), parsed.json)
}

async function cmdEnable(
  manager: HarnessManager,
  args: string[],
  configure: boolean,
): Promise<HarnessCliResult> {
  // Peek positional harness id first so we can use a per-target option schema.
  const idPeek = args.find((a) => !a.startsWith('-'))
  if (!idPeek || !isNodeHarnessId(idPeek)) {
    return fail(
      configure
        ? 'configure is only supported for opencode and acp-grok'
        : 'usage: superone harness enable <claude|codex|opencode|acp-grok> …',
      args.includes('--json'),
    )
  }
  if (configure && idPeek !== 'opencode' && idPeek !== 'acp-grok') {
    return fail('configure is only supported for opencode and acp-grok', args.includes('--json'))
  }

  const schema = enableSchemaFor(idPeek, configure)
  const parsed = parseFlags(args, schema)
  if (!parsed.ok) return fail(parsed.error, parsed.json)

  const id = parsed.positionals[0]
  if (!id || !isNodeHarnessId(id) || id !== idPeek) {
    return fail('invalid harness id', parsed.json)
  }

  try {
    if (id === 'claude' || id === 'codex') {
      const artifact = parsed.values['--artifact']
      const status = await enableManaged(manager, id, artifact)
      return okStatus(status, parsed.json, `enabled ${id} (state=${status.state})`)
    }

    if (id === 'opencode') {
      const command = parsed.values['--command']
      const serverUrl = parsed.values['--server-url']
      if (command && serverUrl) {
        return fail('provide only one of --command or --server-url', parsed.json)
      }
      if (configure) {
        const status = configureOpencode(manager, { command, serverUrl })
        return okStatus(status, parsed.json, `configured opencode (state=${status.state})`)
      }
      const status = enableOpencode(manager, { command, serverUrl })
      return okStatus(status, parsed.json, `enabled opencode (state=${status.state})`)
    }

    // acp-grok
    const command = parsed.values['--command']
    const harnessArgs = parsed.multiValues['--arg'] ?? []
    const defaultArgs = parsed.flags.has('--default-args')
    if (configure) {
      const status = configureAcpGrok(manager, {
        command,
        args: harnessArgs,
        defaultArgs,
      })
      return okStatus(status, parsed.json, `configured acp-grok (state=${status.state})`)
    }
    const status = enableAcpGrok(manager, { command, args: harnessArgs })
    return okStatus(status, parsed.json, `enabled acp-grok (state=${status.state})`)
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), parsed.json)
  }
}

function enableSchemaFor(
  id: NodeHarnessId,
  configure: boolean,
): {
  positionals: number | '0-1'
  flags: Set<string>
  valueFlags: Set<string>
  multiValueFlags?: Set<string>
} {
  if (id === 'claude' || id === 'codex') {
    return {
      positionals: 1,
      flags: new Set(['--json']),
      valueFlags: new Set(['--artifact']),
    }
  }
  if (id === 'opencode') {
    return {
      positionals: 1,
      flags: new Set(['--json']),
      valueFlags: new Set(['--command', '--server-url']),
    }
  }
  // acp-grok
  return {
    positionals: 1,
    flags: new Set(configure ? ['--json', '--default-args'] : ['--json']),
    valueFlags: new Set(['--command']),
    multiValueFlags: new Set(['--arg']),
  }
}

function cmdDisable(manager: HarnessManager, args: string[]): HarnessCliResult {
  const parsed = parseFlags(args, {
    positionals: 1,
    flags: new Set(['--json']),
    valueFlags: new Set(['--drain', '--timeout']),
  })
  if (!parsed.ok) return fail(parsed.error, parsed.json)
  const id = parsed.positionals[0]
  if (!id || !isNodeHarnessId(id)) {
    return fail('usage: superone harness disable <HARNESS_ID> …', parsed.json)
  }
  const drain = parsed.values['--drain'] ?? 'wait'
  if (drain !== 'wait' && drain !== 'cancel') {
    return fail('--drain must be wait or cancel', parsed.json)
  }
  const timeoutRaw = parsed.values['--timeout'] ?? '60s'
  const timeoutMs = parseDurationMs(timeoutRaw)
  if (timeoutMs == null) {
    return fail(`invalid --timeout: ${timeoutRaw}`, parsed.json)
  }
  // Stage 2: CLI process has no live SessionRuntime; drain is a documented no-op.
  void timeoutMs
  void drain
  const status = manager.disable(id)
  return okStatus(status, parsed.json, `disabled ${id}`)
}

function cmdProbe(
  manager: HarnessManager,
  args: string[],
  db: NodeDatabase,
): HarnessCliResult {
  const parsed = parseFlags(args, {
    positionals: 1,
    flags: new Set(['--json']),
    valueFlags: new Set(),
  })
  if (!parsed.ok) return fail(parsed.error, parsed.json)
  const id = parsed.positionals[0]
  if (!id || !isNodeHarnessId(id)) {
    return fail(`unknown or missing harness id: ${id ?? '(none)'}`, parsed.json)
  }
  let providers: ProviderStore | null = null
  try {
    const nodeHome = resolveNodeHome(undefined)
    providers = new ProviderStore(db, nodePaths(nodeHome).providerSecretsKey)
  } catch {
    providers = null
  }
  const result = probeHarnessReadiness(manager, id, providers)
  const status = manager.get(id)
  if (parsed.json) {
    return {
      ok: result.ok,
      exitCode: result.ok ? 0 : 1,
      json: { ...result, status },
      text: '',
    }
  }
  const lines = [
    `harness ${id}: ${result.previousState} → ${result.state}` +
      (result.transitioned ? ' (transitioned)' : ''),
    result.reason,
    ...result.issues.map((i) => `  issue: ${i}`),
  ]
  return {
    ok: result.ok,
    exitCode: result.ok ? 0 : 1,
    json: null,
    text: lines.join('\n'),
  }
}

function cmdDoctor(manager: HarnessManager, args: string[]): HarnessCliResult {
  const parsed = parseFlags(args, {
    positionals: '0-1',
    flags: new Set(['--json']),
    valueFlags: new Set(),
  })
  if (!parsed.ok) return fail(parsed.error, parsed.json)
  const idArg = parsed.positionals[0]
  const ids: NodeHarnessId[] = idArg
    ? isNodeHarnessId(idArg)
      ? [idArg]
      : []
    : NODE_HARNESS_DEFINITIONS.map((d) => d.id)
  if (idArg && ids.length === 0) {
    return fail(`unknown harness id: ${idArg}`, parsed.json)
  }
  const reports = ids.map((id) => doctorOne(manager, id))
  const okAll = reports.every((r) => r.ok)
  if (parsed.json) {
    return {
      ok: okAll,
      exitCode: okAll ? 0 : 2,
      json: idArg ? reports[0] : reports,
      text: '',
    }
  }
  const lines = reports.map((r) => {
    const mark = r.ok ? 'ok' : 'FAIL'
    return `${mark}  ${r.id}  state=${r.status.state} enabled=${r.status.enabled}${r.issues.length ? `  issues=${r.issues.join(';')}` : ''}`
  })
  return {
    ok: okAll,
    exitCode: okAll ? 0 : 2,
    json: null,
    text: lines.join('\n'),
  }
}

async function cmdRepair(manager: HarnessManager, args: string[]): Promise<HarnessCliResult> {
  const parsed = parseFlags(args, {
    positionals: 1,
    flags: new Set(['--json']),
    valueFlags: new Set(['--artifact']),
  })
  if (!parsed.ok) return fail(parsed.error, parsed.json)
  const id = parsed.positionals[0]
  if (id !== 'claude' && id !== 'codex') {
    return fail('repair is only supported for managed harnesses: claude, codex', parsed.json)
  }
  try {
    const status = await enableManaged(manager, id, parsed.values['--artifact'], 'repair')
    return okStatus(status, parsed.json, `repaired ${id} (state=${status.state})`)
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), parsed.json)
  }
}

// --- enable / configure implementations ---

async function enableManaged(
  manager: HarnessManager,
  id: 'claude' | 'codex',
  artifact: string | undefined,
  mode: 'enable' | 'repair' = 'enable',
): Promise<HarnessInstallationStatus> {
  if (!isManagedHarnessId(id)) {
    throw new Error(`not a managed harness: ${id}`)
  }
  const nodeHome = resolveNodeHome(undefined)
  const manifest = loadHarnessReleaseManifest(nodeHome)
  if (!manifest) {
    throw new Error(
      `no release manifest found (set SUPERONE_HARNESS_MANIFEST or write ${nodeHome}/release-manifest.json)`,
    )
  }
  if (!manifest.managedHarnesses[id]) {
    throw new Error(`release manifest does not pin ${id}`)
  }
  if (!artifact) {
    throw new Error(describeExpectedArtifact(id, manifest))
  }
  const abs = requireRegularReadableFile(artifact)
  const installed = await installManagedArtifactFromFile({
    nodeHome,
    harnessId: id,
    artifactPath: abs,
    manifest,
    expectedCliVersion: currentCliVersion(),
    mode,
  })
  const def = getNodeHarnessDefinition(id)
  return manager.update(id, {
    enabled: true,
    state: def.requiresAuth ? 'needs_auth' : 'ready',
    command: installed.installPath,
    runtimeVersion: installed.runtimeVersion,
    diagnosticCode: def.requiresAuth ? 'needs_auth' : null,
    diagnosticFields: def.requiresAuth
      ? { command: installed.installPath, runtimeVersion: installed.runtimeVersion }
      : null,
    lastProbedAt: Date.now(),
    configJson: JSON.stringify({
      artifactPath: installed.installPath,
      source: installed.source,
      cliVersion: installed.cliVersion,
      artifactVersion: installed.artifactVersion,
      digestSha256: installed.digestSha256,
    }),
  })
}

function enableOpencode(
  manager: HarnessManager,
  opts: { command?: string; serverUrl?: string },
): HarnessInstallationStatus {
  if (opts.serverUrl) {
    const safeUrl = validateServerUrl(opts.serverUrl)
    return manager.update('opencode', {
      enabled: true,
      state: 'ready',
      command: null,
      diagnosticCode: null,
      lastProbedAt: Date.now(),
      configJson: JSON.stringify({ serverUrl: safeUrl }),
    })
  }
  const resolved = resolveExternalCommand(opts.command, ['opencode'])
  if (!resolved) {
    return manager.update('opencode', {
      enabled: true,
      state: 'missing',
      command: null,
      diagnosticCode: 'not_found',
      lastProbedAt: Date.now(),
      configJson: JSON.stringify({}),
    })
  }
  return manager.update('opencode', {
    enabled: true,
    state: 'ready',
    command: resolved,
    diagnosticCode: null,
    lastProbedAt: Date.now(),
    configJson: JSON.stringify({ command: resolved }),
  })
}

/**
 * Transactional reconfigure: probe first; on failure leave previous row intact.
 */
function configureOpencode(
  manager: HarnessManager,
  opts: { command?: string; serverUrl?: string },
): HarnessInstallationStatus {
  if (!opts.command && !opts.serverUrl) {
    throw new Error('configure opencode requires --command or --server-url')
  }
  if (opts.serverUrl) {
    const safeUrl = validateServerUrl(opts.serverUrl)
    // URL accepted → replace atomically.
    return manager.update('opencode', {
      enabled: true,
      state: 'ready',
      command: null,
      diagnosticCode: null,
      lastProbedAt: Date.now(),
      configJson: JSON.stringify({ serverUrl: safeUrl }),
    })
  }
  const resolved = resolveExternalCommand(opts.command, [])
  if (!resolved) {
    throw new Error(
      `proposed opencode command is not a usable executable: ${opts.command ?? '(missing)'}`,
    )
  }
  return manager.update('opencode', {
    enabled: true,
    state: 'ready',
    command: resolved,
    diagnosticCode: null,
    lastProbedAt: Date.now(),
    configJson: JSON.stringify({ command: resolved }),
  })
}

function enableAcpGrok(
  manager: HarnessManager,
  opts: { command?: string; args: string[] },
): HarnessInstallationStatus {
  const defaultArgs = ['agent', 'stdio']
  const args = sanitizeHarnessArgs(opts.args.length > 0 ? opts.args : defaultArgs)
  const resolved = resolveExternalCommand(opts.command, ['grok'])
  if (!resolved) {
    return manager.update('acp-grok', {
      enabled: true,
      state: 'missing',
      command: null,
      diagnosticCode: 'not_found',
      lastProbedAt: Date.now(),
      configJson: JSON.stringify({ args, usesDefaultArgs: opts.args.length === 0 }),
    })
  }
  return manager.update('acp-grok', {
    enabled: true,
    state: 'ready',
    command: resolved,
    diagnosticCode: null,
    lastProbedAt: Date.now(),
    configJson: JSON.stringify({
      command: resolved,
      args,
      usesDefaultArgs: opts.args.length === 0,
    }),
  })
}

function configureAcpGrok(
  manager: HarnessManager,
  opts: { command?: string; args: string[]; defaultArgs: boolean },
): HarnessInstallationStatus {
  const current = manager.get('acp-grok')
  const raw = manager.readRawRow('acp-grok')
  let previousArgs: string[] = ['agent', 'stdio']
  if (raw?.config_json) {
    try {
      const parsed = JSON.parse(raw.config_json) as { args?: string[] }
      if (Array.isArray(parsed.args)) previousArgs = parsed.args
    } catch {
      /* ignore */
    }
  }
  const args = opts.defaultArgs
    ? ['agent', 'stdio']
    : opts.args.length > 0
      ? sanitizeHarnessArgs(opts.args)
      : previousArgs

  // Must change something.
  if (!opts.command && opts.args.length === 0 && !opts.defaultArgs) {
    throw new Error('configure acp-grok requires --command, --arg, and/or --default-args')
  }

  const commandToProbe = opts.command ?? current.command ?? undefined
  const resolved = resolveExternalCommand(commandToProbe, opts.command ? [] : ['grok'])
  if (!resolved) {
    throw new Error(
      `proposed acp-grok command is not a usable executable: ${commandToProbe ?? '(missing)'}`,
    )
  }
  let previousUsesDefault = false
  if (raw?.config_json) {
    try {
      const parsed = JSON.parse(raw.config_json) as { usesDefaultArgs?: boolean }
      previousUsesDefault = parsed.usesDefaultArgs === true
    } catch {
      /* ignore */
    }
  }
  const usesDefaultArgs = opts.defaultArgs
    ? true
    : opts.args.length > 0
      ? false
      : previousUsesDefault

  return manager.update('acp-grok', {
    enabled: true,
    state: 'ready',
    command: resolved,
    diagnosticCode: null,
    lastProbedAt: Date.now(),
    configJson: JSON.stringify({
      command: resolved,
      args,
      usesDefaultArgs,
    }),
  })
}

// --- doctor / show ---

function doctorOne(manager: HarnessManager, id: NodeHarnessId) {
  const status = manager.get(id)
  const detail = getShowDetail(manager, id)
  const issues: string[] = []
  const def = getNodeHarnessDefinition(id)

  if (status.enabled && status.state === 'ready') {
    if (def.runtimeSource === 'external') {
      if (!status.command) {
        if (!(id === 'opencode' && detail.configSummary && 'serverUrl' in detail.configSummary)) {
          issues.push('ready_without_command')
        }
      } else {
        issues.push(...probeExecutableIssues(status.command))
      }
    }
  }

  if (status.enabled && status.state === 'needs_auth') {
    issues.push('needs_auth')
    if (status.command) {
      issues.push(...probeReadableFileIssues(status.command))
    } else {
      issues.push('artifact_missing')
    }
  }

  if (status.enabled && (status.state === 'missing' || status.state === 'error')) {
    issues.push(`state_${status.state}`)
  }
  if (status.enabled && status.state === 'incompatible') {
    issues.push('incompatible')
  }

  return {
    id,
    ok: issues.length === 0,
    status,
    lastProbedAt: detail.lastProbedAt,
    installationPath: detail.installationPath,
    issues,
  }
}

function getShowDetail(manager: HarnessManager, id: NodeHarnessId): HarnessShowDetail {
  const status = manager.get(id)
  const row = manager.readRawRow(id)
  let manifest = null
  try {
    manifest = loadHarnessReleaseManifest(resolveNodeHome(undefined))
  } catch {
    manifest = null
  }
  return {
    ...status,
    lastProbedAt: row?.last_probed_at ?? null,
    installationPath: status.command ?? null,
    configSummary: buildPublicConfigSummary(id, row?.config_json ?? null, status),
    requiredRuntimeVersion: requiredRuntimeVersion(id, manifest),
  }
}

/**
 * Allowlisted public config only. Never dumps raw config_json.
 * - command / artifactPath: absolute paths already on status when safe
 * - serverUrl: origin only (scheme + host + port); never path/query/fragment
 * - args: only count + usesDefaultArgs (never raw values)
 */
function buildPublicConfigSummary(
  id: NodeHarnessId,
  configJson: string | null,
  status: HarnessInstallationStatus,
): Record<string, unknown> | null {
  if (!configJson) {
    return status.command ? { command: status.command } : null
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(configJson) as Record<string, unknown>
  } catch {
    return null
  }
  const out: Record<string, unknown> = {}
  if (id === 'claude' || id === 'codex') {
    if (typeof parsed.artifactPath === 'string' && isAbsolute(parsed.artifactPath)) {
      out.artifactPath = parsed.artifactPath
    }
    if (parsed.source === 'offline-artifact') out.source = 'offline-artifact'
    if (typeof parsed.cliVersion === 'string') out.cliVersion = parsed.cliVersion
    if (typeof parsed.artifactVersion === 'string') out.artifactVersion = parsed.artifactVersion
    if (typeof parsed.digestSha256 === 'string' && /^[a-f0-9]{64}$/.test(parsed.digestSha256)) {
      out.digestSha256 = parsed.digestSha256
    }
  } else if (id === 'opencode') {
    if (typeof parsed.command === 'string' && isAbsolute(parsed.command)) {
      out.command = parsed.command
    }
    if (typeof parsed.serverUrl === 'string') {
      out.serverUrl = redactServerUrlForDisplay(parsed.serverUrl)
    }
  } else if (id === 'acp-grok') {
    if (typeof parsed.command === 'string' && isAbsolute(parsed.command)) {
      out.command = parsed.command
    }
    if (Array.isArray(parsed.args)) {
      out.argCount = parsed.args.length
    }
    if (typeof parsed.usesDefaultArgs === 'boolean') {
      out.usesDefaultArgs = parsed.usesDefaultArgs
    }
  }
  return Object.keys(out).length ? out : null
}

// --- path / URL / arg validation ---

function requireRegularReadableFile(path: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`path must be absolute: ${path}`)
  }
  if (!existsSync(path)) {
    throw new Error(`artifact not found: ${path}`)
  }
  const st = statSync(path)
  if (!st.isFile()) {
    throw new Error(`artifact is not a regular file: ${path}`)
  }
  try {
    accessSync(path, constants.R_OK)
  } catch {
    throw new Error(`artifact not readable: ${path}`)
  }
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** Resolve an external command to an absolute regular executable file, or null. */
function resolveExternalCommand(
  explicit: string | undefined,
  pathCandidates: string[],
): string | null {
  if (explicit) {
    if (!isAbsolute(explicit)) {
      // Public contract requires ABSOLUTE_PATH for --command.
      return null
    }
    return isUsableExecutable(explicit)
  }
  const pathEnv = process.env.PATH || ''
  const dirs = pathEnv.split(':').filter(Boolean)
  const home = process.env.HOME || homedir()
  const extra = [
    `${home}/.local/bin`,
    `${home}/.npm-global/bin`,
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ]
  for (const name of pathCandidates) {
    for (const dir of [...dirs, ...extra]) {
      const candidate = resolve(dir, name)
      const ok = isUsableExecutable(candidate)
      if (ok) return ok
    }
  }
  return null
}

function isUsableExecutable(path: string): string | null {
  if (!existsSync(path)) return null
  let st
  try {
    st = statSync(path)
  } catch {
    return null
  }
  if (!st.isFile()) return null
  try {
    accessSync(path, constants.X_OK)
  } catch {
    return null
  }
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function probeExecutableIssues(path: string): string[] {
  if (!existsSync(path)) return ['command_missing']
  let st
  try {
    st = statSync(path)
  } catch {
    return ['command_missing']
  }
  if (!st.isFile()) return ['command_not_file']
  try {
    accessSync(path, constants.X_OK)
  } catch {
    return ['command_not_executable']
  }
  return []
}

function probeReadableFileIssues(path: string): string[] {
  if (!existsSync(path)) return ['artifact_missing']
  try {
    if (!statSync(path).isFile()) return ['artifact_not_file']
  } catch {
    return ['artifact_missing']
  }
  try {
    accessSync(path, constants.R_OK)
  } catch {
    return ['artifact_not_readable']
  }
  return []
}

function validateServerUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('--server-url is not a valid URL')
  }
  if (url.username || url.password) {
    throw new Error('--server-url must not include credentials')
  }
  // Stage 2: reject all query parameters until secret storage owns them.
  if (url.search && url.search !== '?') {
    throw new Error('--server-url must not include query parameters')
  }
  if (url.hash) {
    throw new Error('--server-url must not include a fragment')
  }
  const host = url.hostname.toLowerCase()
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  if (url.protocol === 'http:') {
    if (!loopback) {
      throw new Error('--server-url http is only allowed for loopback hosts')
    }
  } else if (url.protocol !== 'https:') {
    throw new Error('--server-url must be http(s)')
  }
  // Persist origin + pathname only (no userinfo/query/fragment). Path may be
  // needed for the server root; public display still strips to origin.
  return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`
}

/** Public display: origin only — never path/query/fragment/userinfo (token paths). */
function redactServerUrlForDisplay(raw: string): string {
  try {
    const url = new URL(raw)
    return url.origin
  } catch {
    return '[invalid-url]'
  }
}

function sanitizeHarnessArgs(args: string[]): string[] {
  for (const a of args) {
    if (looksLikeSecretArg(a)) {
      throw new Error('refusing to store credential-like --arg values')
    }
  }
  return args
}

function looksLikeSecretArg(value: string): boolean {
  if (/Bearer\s+\S+/i.test(value)) return true
  if (/\b(password|passwd|token|secret|api[_-]?key)\b\s*=/i.test(value)) return true
  if (/^[A-Z][A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)\s*=/.test(value)) return true
  if (/\bsk-[A-Za-z0-9_-]{8,}\b/.test(value)) return true
  return false
}

// --- flag parsing ---

type ParseOk = {
  ok: true
  positionals: string[]
  flags: Set<string>
  values: Record<string, string>
  multiValues: Record<string, string[]>
  json: boolean
}
type ParseErr = { ok: false; error: string; json: boolean }

function wantsJson(args: string[]): boolean {
  return args.includes('--json')
}

function parseFlags(
  args: string[],
  opts: {
    positionals: number | '0-1'
    flags: Set<string>
    valueFlags: Set<string>
    multiValueFlags?: Set<string>
  },
): ParseOk | ParseErr {
  const positionals: string[] = []
  const flags = new Set<string>()
  const values: Record<string, string> = {}
  const multiValues: Record<string, string[]> = {}
  const multi = opts.multiValueFlags ?? new Set<string>()
  const jsonRequested = wantsJson(args)

  const err = (message: string): ParseErr => ({
    ok: false,
    error: message,
    json: jsonRequested,
  })

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--') {
      // Remaining tokens are positionals / multi-arg values as literals.
      positionals.push(...args.slice(i + 1))
      break
    }
    if (a.startsWith('-')) {
      // Support --flag=value for value and multi-value flags (incl. dash-leading).
      const eq = a.indexOf('=')
      const flagName = eq >= 0 ? a.slice(0, eq) : a
      const inlineValue = eq >= 0 ? a.slice(eq + 1) : undefined

      if (DEFERRED_FLAGS.has(flagName)) {
        return err(
          `${flagName} is not implemented in Stage 2 (deferred: env/password/timeout options)`,
        )
      }
      if (opts.flags.has(flagName)) {
        if (inlineValue !== undefined) {
          return err(`${flagName} does not take a value`)
        }
        flags.add(flagName)
        continue
      }
      if (opts.valueFlags.has(flagName) || multi.has(flagName)) {
        let v = inlineValue
        if (v === undefined) {
          // Multi-value --arg allows the next token even when it begins with `-`
          // (ACP args like --profile). Ordinary value flags still reject that
          // form so `--command --foo` is not silently accepted.
          const next = args[i + 1]
          if (next == null) {
            return err(`missing value for ${flagName}`)
          }
          if (!multi.has(flagName) && next.startsWith('-') && next !== '-') {
            return err(`missing value for ${flagName}`)
          }
          v = next
          i++
        }
        if (multi.has(flagName)) {
          multiValues[flagName] = multiValues[flagName] ?? []
          multiValues[flagName]!.push(v)
        } else {
          values[flagName] = v
        }
        continue
      }
      return err(`unknown option: ${flagName}`)
    }
    positionals.push(a)
  }

  const json = flags.has('--json') || jsonRequested
  if (opts.positionals === '0-1') {
    if (positionals.length > 1) {
      return err(`expected at most 1 argument, got ${positionals.length}`)
    }
  } else if (positionals.length !== opts.positionals) {
    return err(`expected ${opts.positionals} argument(s), got ${positionals.length}`)
  }
  return { ok: true, positionals, flags, values, multiValues, json }
}

function parseDurationMs(raw: string): number | null {
  const m = /^(\d+)(ms|s|m)?$/.exec(raw.trim())
  if (!m) return null
  const n = Number(m[1])
  const unit = m[2] || 's'
  if (unit === 'ms') return n
  if (unit === 's') return n * 1000
  if (unit === 'm') return n * 60_000
  return null
}

// --- output helpers ---

function formatList(list: HarnessInstallationStatus[], json: boolean): HarnessCliResult {
  if (json) {
    return { ok: true, exitCode: 0, json: list, text: '' }
  }
  const lines = list.map((h) => {
    const ver = h.runtimeVersion ? `  ${h.runtimeVersion}` : ''
    const cmd = h.command ? `  ${h.command}` : ''
    return `${h.id.padEnd(10)} ${h.runtimeSource.padEnd(8)} enabled=${h.enabled ? 'yes' : 'no '}  state=${h.state}${ver}${cmd}`
  })
  return { ok: true, exitCode: 0, json: null, text: lines.join('\n') }
}

function formatShow(detail: HarnessShowDetail, json: boolean): HarnessCliResult {
  if (json) {
    return { ok: true, exitCode: 0, json: detail, text: '' }
  }
  const lines = [
    `id:               ${detail.id}`,
    `runtimeSource:    ${detail.runtimeSource}`,
    `enabled:          ${detail.enabled}`,
    `state:            ${detail.state}`,
    `requiresAuth:     ${detail.requiresAuth}`,
    `runtimeVersion:   ${detail.runtimeVersion ?? '-'}`,
    `command:          ${detail.command ?? '-'}`,
    `installationPath: ${detail.installationPath ?? '-'}`,
    `lastProbedAt:     ${detail.lastProbedAt ?? '-'}`,
    `requiredRuntime:  ${detail.requiredRuntimeVersion ?? '-'}`,
    `diagnostic:       ${detail.diagnostic ? `${detail.diagnostic.code}: ${detail.diagnostic.message}` : '-'}`,
    `config:           ${detail.configSummary ? JSON.stringify(detail.configSummary) : '-'}`,
  ]
  return { ok: true, exitCode: 0, json: null, text: lines.join('\n') }
}

function okStatus(
  status: HarnessInstallationStatus,
  json: boolean,
  text: string,
): HarnessCliResult {
  if (json) return { ok: true, exitCode: 0, json: status, text: '' }
  return { ok: true, exitCode: 0, json: null, text }
}

function fail(message: string, json: boolean): HarnessCliResult {
  if (json) {
    return {
      ok: false,
      exitCode: 1,
      json: { ok: false, error: message },
      text: '',
    }
  }
  return { ok: false, exitCode: 1, json: null, text: message }
}
