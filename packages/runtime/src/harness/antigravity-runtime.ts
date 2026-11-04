import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { HarnessInstallationStatus } from '@superone/shared/environment'
import {
  ANTIGRAVITY_RELEASE_VERSION,
  antigravityExecutableNames,
  resolveAntigravityReleaseAsset,
  type AntigravityReleaseAsset,
} from './antigravity-release'
import { extractVerifiedAntigravityZip } from './antigravity-zip'
import { resolveExternalCommand, sanitizeHarnessArgs } from './enable'
import {
  managedVersionDir,
  pruneManagedVersions,
  readCurrentPointer,
  resolveActiveInstallRoot,
  writeCurrentPointer,
} from './managed-layout'
import { harnessDownloadDir } from './managed-tarball-installer'
import type { HarnessManager } from './manager'
import { createResumableDownloadToFile, type ResumableLog } from './resumable-download'
import type { DownloadToFile, HttpFetch } from './tarball-fetch'
import type { HarnessCatalogReader, HarnessKernelDeps, InstalledManagedRuntime } from './types'

export { extractVerifiedAntigravityZip } from './antigravity-zip'

const INSTALL_META_FILENAME = 'install-meta.json'

export interface AntigravityResolvedRuntime {
  executablePath: string
  harnessPath: string
  args: string[]
  source: 'override' | 'managed' | 'path'
  runtimeVersion?: string
}

export function antigravityManagedPrefix(homeRoot: string): string {
  return resolve(homeRoot, 'acp-antigravity')
}

function isExecutableFileWithSize(
  filePath: string,
  expectedBytes?: number,
  platform: NodeJS.Platform = process.platform,
): boolean {
  try {
    const st = statSync(filePath)
    if (!st.isFile()) return false
    if (expectedBytes !== undefined && st.size !== expectedBytes) return false
    if (platform === 'win32') return true
    return (st.mode & 0o111) !== 0
  } catch {
    return false
  }
}

export function resolveAntigravityPairFromExecutable(
  executableCandidate: string,
  source: 'override' | 'managed' | 'path',
  runtimeVersion?: string,
  platform: NodeJS.Platform = process.platform,
): AntigravityResolvedRuntime | null {
  if (!isExecutableFileWithSize(executableCandidate, undefined, platform)) return null
  let realExec: string
  try {
    realExec = realpathSync(executableCandidate)
  } catch {
    return null
  }
  const dir = dirname(realExec)
  const names = antigravityExecutableNames(platform)
  const harnessCandidate = join(dir, names.harness)
  if (!isExecutableFileWithSize(harnessCandidate, undefined, platform)) return null
  let realHarness: string
  try {
    realHarness = realpathSync(harnessCandidate)
  } catch {
    return null
  }
  return {
    executablePath: realExec,
    harnessPath: realHarness,
    args: platform === 'linux' ? ['--uid='] : [],
    source,
    ...(runtimeVersion ? { runtimeVersion } : {}),
  }
}

export function resolveManagedAntigravityInRoot(
  installRoot: string,
  platform: NodeJS.Platform = process.platform,
): AntigravityResolvedRuntime | null {
  if (!installRoot || !existsSync(installRoot)) return null
  const names = antigravityExecutableNames(platform)
  const execPath = join(installRoot, names.executable)
  const harnessPath = join(installRoot, names.harness)
  let expectedExecBytes: number | undefined
  let expectedHarnessBytes: number | undefined
  let runtimeVersion: string | undefined
  try {
    const metaPath = join(installRoot, INSTALL_META_FILENAME)
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
        runtimeVersion?: string
        executableBytes?: number
        harnessBytes?: number
      }
      if (typeof meta.runtimeVersion === 'string' && meta.runtimeVersion.trim()) {
        runtimeVersion = meta.runtimeVersion.trim()
      }
      if (typeof meta.executableBytes === 'number') expectedExecBytes = meta.executableBytes
      if (typeof meta.harnessBytes === 'number') expectedHarnessBytes = meta.harnessBytes
    }
  } catch {
    return null
  }
  if (!isExecutableFileWithSize(execPath, expectedExecBytes, platform)) return null
  if (!isExecutableFileWithSize(harnessPath, expectedHarnessBytes, platform)) return null
  return {
    executablePath: execPath,
    harnessPath,
    args: platform === 'linux' ? ['--uid='] : [],
    source: 'managed',
    ...(runtimeVersion ? { runtimeVersion } : {}),
  }
}

export function resolveManagedAntigravityFromHome(
  homeRoot: string,
  platform: NodeJS.Platform = process.platform,
): AntigravityResolvedRuntime | null {
  const prefix = antigravityManagedPrefix(homeRoot)
  const activeRoot = resolveActiveInstallRoot(prefix)
  if (!activeRoot) return null
  return resolveManagedAntigravityInRoot(activeRoot, platform)
}

export function resolveAntigravityRuntime(
  catalog: HarnessCatalogReader,
  opts?: {
    homeRoot?: string
    override?: { command?: string; args?: string[]; env?: Record<string, string> }
    platform?: NodeJS.Platform
  },
): AntigravityResolvedRuntime | null {
  const status = catalog.get('acp-antigravity')
  if (!status.enabled) return null
  const platform = opts?.platform ?? process.platform
  const names = antigravityExecutableNames(platform)
  const config = catalog.getExternalLaunchConfig?.('acp-antigravity') ?? {}
  const explicitOverride =
    opts?.override?.command?.trim() ||
    opts?.override?.env?.SUPERONE_ANTIGRAVITY_BINARY?.trim() ||
    process.env.SUPERONE_ANTIGRAVITY_BINARY?.trim() ||
    (config.commandSource === 'explicit' ? config.command?.trim() : undefined)

  if (explicitOverride) {
    const isBare =
      !explicitOverride.includes('/') &&
      !explicitOverride.includes('\\') &&
      !isAbsolute(explicitOverride)
    const resolvedCmd = resolveExternalCommand(
      isBare ? undefined : explicitOverride,
      [isBare ? explicitOverride : names.executable],
      { preserveSymlinks: true, pathEnv: opts?.override?.env?.PATH },
    )
    if (!resolvedCmd) return null
    const pair = resolveAntigravityPairFromExecutable(resolvedCmd, 'override', undefined, platform)
    if (!pair) return null
    return {
      ...pair,
      args: opts?.override?.args ?? config.args ?? pair.args,
    }
  }

  if (opts?.homeRoot) {
    const managed = resolveManagedAntigravityFromHome(opts.homeRoot, platform)
    if (managed) {
      return {
        ...managed,
        args: opts?.override?.args ?? config.args ?? managed.args,
      }
    }
  }

  if (status.command && existsSync(status.command)) {
    const fromCatalog = resolveAntigravityPairFromExecutable(
      status.command,
      'managed',
      status.runtimeVersion,
      platform,
    )
    if (fromCatalog) {
      return {
        ...fromCatalog,
        args: opts?.override?.args ?? config.args ?? fromCatalog.args,
      }
    }
  }

  const fromPath = resolveExternalCommand(undefined, [names.executable], {
    preserveSymlinks: true,
    pathEnv: opts?.override?.env?.PATH,
  })
  if (fromPath) {
    const pair = resolveAntigravityPairFromExecutable(fromPath, 'path', undefined, platform)
    if (pair) {
      return {
        ...pair,
        args: opts?.override?.args ?? config.args ?? pair.args,
      }
    }
  }

  return null
}

export interface InstallAntigravityOptions {
  homeRoot: string
  platform?: NodeJS.Platform
  arch?: string
  asset?: AntigravityReleaseAsset | null
  httpFetch?: HttpFetch
  downloadToFile?: DownloadToFile
  onProgress?: (received: number, total: number) => void
  log?: ResumableLog
}

export async function installAntigravityManagedRuntime(
  opts: InstallAntigravityOptions,
): Promise<InstalledManagedRuntime> {
  const platform = opts.platform ?? process.platform
  const arch = opts.arch ?? process.arch
  const asset =
    opts.asset === undefined ? resolveAntigravityReleaseAsset(platform, arch) : opts.asset
  if (!asset) {
    throw new Error(`Google does not publish an Antigravity runtime for ${platform}-${arch}`)
  }

  const prefix = antigravityManagedPrefix(opts.homeRoot)
  mkdirSync(prefix, { recursive: true })
  const versionDir = managedVersionDir(prefix, asset.version)
  const previousPointer = readCurrentPointer(prefix)?.runtimeVersion ?? null

  const existing = resolveManagedAntigravityInRoot(versionDir, platform)
  if (existing && existing.runtimeVersion === asset.version) {
    writeCurrentPointer(prefix, asset.version, { installRoot: versionDir })
    return {
      command: existing.executablePath,
      runtimeVersion: asset.version,
      source: 'google-official-zip',
      detail: {
        installPrefix: versionDir,
        harnessPath: existing.harnessPath,
        digestSha256: asset.sha256,
        reused: '1',
      },
    }
  }

  const httpFetch = opts.httpFetch ?? ((input, init) => globalThis.fetch(input, init))
  const downloadToFile =
    opts.downloadToFile ?? createResumableDownloadToFile(httpFetch, opts.log)
  const downloadDir = harnessDownloadDir(opts.homeRoot)
  mkdirSync(downloadDir, { recursive: true })
  const partialPath = join(downloadDir, `acp-antigravity-${asset.sha256.slice(0, 24)}.zip.partial`)

  const downloaded = await downloadToFile(asset.url, partialPath, opts.onProgress)
  if (
    downloaded.byteLength !== asset.archiveBytes ||
    downloaded.sha256Hex.toLowerCase() !== asset.sha256.toLowerCase()
  ) {
    try {
      rmSync(partialPath, { force: true })
    } catch {
      void 0
    }
    throw new Error(
      `Antigravity download failed integrity verification (expected ${asset.sha256} / ${asset.archiveBytes}B, got ${downloaded.sha256Hex} / ${downloaded.byteLength}B)`,
    )
  }

  const versionsParent = dirname(versionDir)
  mkdirSync(versionsParent, { recursive: true })
  const stagingDir = mkdtempSync(join(versionsParent, `.staging-antigravity-${asset.version}-`))
  try {
    await extractVerifiedAntigravityZip(partialPath, stagingDir, asset, platform)
    writeFileSync(
      join(stagingDir, INSTALL_META_FILENAME),
      JSON.stringify(
        {
          harnessId: 'acp-antigravity',
          runtimeVersion: asset.version,
          digestSha256: asset.sha256,
          executableName: asset.executable.name,
          executableBytes: asset.executable.bytes,
          harnessName: asset.harness.name,
          harnessBytes: asset.harness.bytes,
          source: 'google-official-zip',
          installedAt: Date.now(),
        },
        null,
        2,
      ),
    )
    if (existsSync(versionDir)) {
      rmSync(versionDir, { recursive: true, force: true })
    }
    renameSync(stagingDir, versionDir)
    try {
      rmSync(partialPath, { force: true })
    } catch {
      void 0
    }
  } catch (err) {
    rmSync(stagingDir, { recursive: true, force: true })
    throw err
  }

  const verified = resolveManagedAntigravityInRoot(versionDir, platform)
  if (!verified) {
    throw new Error(`Antigravity install succeeded but binaries failed verification under ${versionDir}`)
  }

  writeCurrentPointer(prefix, asset.version, { installRoot: versionDir })
  const keep = [asset.version, previousPointer].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  )
  pruneManagedVersions(prefix, keep)

  return {
    command: verified.executablePath,
    runtimeVersion: asset.version,
    source: 'google-official-zip',
    detail: {
      installPrefix: versionDir,
      harnessPath: verified.harnessPath,
      digestSha256: asset.sha256,
    },
  }
}

export async function enableAcpAntigravity(
  manager: HarnessManager,
  opts: {
    command?: string
    args: string[]
    forcePin?: boolean
    onProgress?: (received: number, total: number) => void
  },
  deps: HarnessKernelDeps,
): Promise<HarnessInstallationStatus> {
  const defaultArgs = process.platform === 'linux' ? ['--uid='] : []
  const args = sanitizeHarnessArgs(opts.args.length > 0 ? opts.args : defaultArgs)
  const names = antigravityExecutableNames(process.platform)

  if (opts.command?.trim()) {
    const resolved = resolveExternalCommand(opts.command.trim(), [names.executable], {
      preserveSymlinks: true,
    })
    const pair = resolved
      ? resolveAntigravityPairFromExecutable(resolved, 'override', undefined, process.platform)
      : null
    if (!pair) {
      return manager.update('acp-antigravity', {
        enabled: true,
        state: 'missing',
        command: null,
        diagnosticCode: 'not_found',
        lastProbedAt: Date.now(),
        configJson: JSON.stringify({
          commandSource: 'explicit',
          command: opts.command.trim(),
          args,
          usesDefaultArgs: opts.args.length === 0,
        }),
      })
    }
    return manager.update('acp-antigravity', {
      enabled: true,
      state: 'ready',
      command: pair.executablePath,
      diagnosticCode: null,
      diagnosticFields: null,
      lastProbedAt: Date.now(),
      configJson: JSON.stringify({
        command: pair.executablePath,
        harnessPath: pair.harnessPath,
        commandSource: 'explicit',
        args,
        usesDefaultArgs: opts.args.length === 0,
      }),
    })
  }

  if (!opts.forcePin) {
    const existingManaged = resolveManagedAntigravityFromHome(deps.home.root, process.platform)
    if (existingManaged && existingManaged.runtimeVersion === ANTIGRAVITY_RELEASE_VERSION) {
      return manager.update('acp-antigravity', {
        enabled: true,
        state: 'ready',
        command: existingManaged.executablePath,
        runtimeVersion: existingManaged.runtimeVersion,
        diagnosticCode: null,
        diagnosticFields: null,
        lastProbedAt: Date.now(),
        configJson: JSON.stringify({
          command: existingManaged.executablePath,
          harnessPath: existingManaged.harnessPath,
          source: 'google-official-zip',
          runtimeVersion: existingManaged.runtimeVersion,
          args,
          usesDefaultArgs: opts.args.length === 0,
        }),
      })
    }

    const fromPath = resolveExternalCommand(undefined, [names.executable], {
      preserveSymlinks: true,
    })
    const pairFromPath = fromPath
      ? resolveAntigravityPairFromExecutable(fromPath, 'path', undefined, process.platform)
      : null
    if (pairFromPath) {
      return manager.update('acp-antigravity', {
        enabled: true,
        state: 'ready',
        command: pairFromPath.executablePath,
        diagnosticCode: null,
        diagnosticFields: null,
        lastProbedAt: Date.now(),
        configJson: JSON.stringify({
          command: pairFromPath.executablePath,
          harnessPath: pairFromPath.harnessPath,
          commandSource: 'path',
          args,
          usesDefaultArgs: opts.args.length === 0,
        }),
      })
    }
  }

  const installed = await installAntigravityManagedRuntime({
    homeRoot: deps.home.root,
    httpFetch: deps.httpFetch,
    onProgress: opts.onProgress ?? deps.onProgress,
  })
  return manager.update('acp-antigravity', {
    enabled: true,
    state: 'ready',
    command: installed.command,
    runtimeVersion: installed.runtimeVersion,
    diagnosticCode: null,
    diagnosticFields: null,
    lastProbedAt: Date.now(),
    configJson: JSON.stringify({
      command: installed.command,
      source: installed.source,
      ...(installed.detail ?? {}),
      runtimeVersion: installed.runtimeVersion,
      args,
      usesDefaultArgs: opts.args.length === 0,
    }),
  })
}
