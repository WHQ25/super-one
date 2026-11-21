import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type { LspRunningWorkspace, LspServerId, LspServerInfo } from '@superone/shared/desktop-lsp'
import { readAppSettings } from './app-settings-service'
import log from './logger'
import {
  extractGithubRepo,
  fetchGithubStarsForRepos,
  fetchMasonLspRegistry,
  loadInstalledRegistryServers,
  readCachedGithubStars,
  saveInstalledRegistryServers,
  type InstalledRegistryServer,
  type MasonRegistryEntry,
} from './lsp-registry'
import { ensureShellPath } from './shell-path'
import { superoneHome } from './superone-home'

interface LspProviderSpec {
  id: LspServerId
  label: string
  serverName: string
  languages: string[]
  binaryName: string
  args: string[]
  npmPackages: string[]
  githubRepo?: string
  installHint?: string
}

const PROVIDERS: LspProviderSpec[] = [
  {
    id: 'typescript',
    label: 'TypeScript / JavaScript',
    serverName: 'typescript-language-server',
    languages: ['typescript', 'tsx', 'javascript', 'jsx'],
    binaryName: 'typescript-language-server',
    args: ['--stdio'],
    npmPackages: ['typescript-language-server', 'typescript'],
    githubRepo: 'typescript-language-server/typescript-language-server',
  },
  {
    id: 'python',
    label: 'Python',
    serverName: 'pyright',
    languages: ['python'],
    binaryName: 'pyright-langserver',
    args: ['--stdio'],
    npmPackages: ['pyright'],
    githubRepo: 'microsoft/pyright',
  },
  {
    id: 'json',
    label: 'JSON',
    serverName: 'vscode-json-language-server',
    languages: ['json', 'jsonc'],
    binaryName: 'vscode-json-language-server',
    args: ['--stdio'],
    npmPackages: ['vscode-langservers-extracted'],
    githubRepo: 'hrsh7th/vscode-langservers-extracted',
  },
  {
    id: 'css',
    label: 'CSS / SCSS / Less',
    serverName: 'vscode-css-language-server',
    languages: ['css', 'scss', 'less'],
    binaryName: 'vscode-css-language-server',
    args: ['--stdio'],
    npmPackages: ['vscode-langservers-extracted'],
    githubRepo: 'hrsh7th/vscode-langservers-extracted',
  },
  {
    id: 'html',
    label: 'HTML',
    serverName: 'vscode-html-language-server',
    languages: ['html'],
    binaryName: 'vscode-html-language-server',
    args: ['--stdio'],
    npmPackages: ['vscode-langservers-extracted'],
    githubRepo: 'hrsh7th/vscode-langservers-extracted',
  },
  {
    id: 'yaml',
    label: 'YAML',
    serverName: 'yaml-language-server',
    languages: ['yaml'],
    binaryName: 'yaml-language-server',
    args: ['--stdio'],
    npmPackages: ['yaml-language-server'],
    githubRepo: 'redhat-developer/yaml-language-server',
  },
  {
    id: 'go',
    label: 'Go',
    serverName: 'gopls',
    languages: ['go'],
    binaryName: 'gopls',
    args: [],
    npmPackages: [],
    githubRepo: 'golang/tools',
    installHint: 'go install golang.org/x/tools/gopls@latest',
  },
  {
    id: 'rust',
    label: 'Rust',
    serverName: 'rust-analyzer',
    languages: ['rust'],
    binaryName: 'rust-analyzer',
    args: [],
    npmPackages: [],
    githubRepo: 'rust-lang/rust-analyzer',
    installHint: 'rustup component add rust-analyzer',
  },
  {
    id: 'clangd',
    label: 'C / C++',
    serverName: 'clangd',
    languages: ['c', 'cpp'],
    binaryName: 'clangd',
    args: [],
    npmPackages: [],
    githubRepo: 'clangd/clangd',
    installHint: process.platform === 'darwin' ? 'brew install llvm' : 'Install clangd via system package manager',
  },
]

const IDLE_TIMEOUT_MS = 5 * 60 * 1000

function managedServerDir(serverId: string): string {
  return join(superoneHome(), 'lsp', serverId)
}

function managedBinPath(provider: LspProviderSpec): string {
  const ext = process.platform === 'win32' ? '.cmd' : ''
  return join(managedServerDir(provider.id), 'node_modules', '.bin', `${provider.binaryName}${ext}`)
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function execAsync(
  cmd: string,
  args: string[],
  cwd?: string,
  extraEnv?: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, env: { ...process.env, ...extraEnv } }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message))
        return
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
    })
  })
}

async function findOnPath(binaryName: string): Promise<string | null> {
  await ensureShellPath()
  const lookup = process.platform === 'win32' ? 'where' : 'which'
  try {
    const { stdout } = await execAsync(lookup, [binaryName])
    const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    return first ?? null
  } catch {
    return null
  }
}

async function readManagedVersion(provider: LspProviderSpec): Promise<string | null> {
  const pkgName = provider.npmPackages[0]
  if (!pkgName) return null
  try {
    const pkgPath = join(managedServerDir(provider.id), 'node_modules', pkgName, 'package.json')
    const raw = await readFile(pkgPath, 'utf8')
    const parsed = JSON.parse(raw) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

async function resolveBinary(provider: LspProviderSpec): Promise<{
  binaryPath: string | null
  managed: boolean
  version: string | null
}> {
  const managed = managedBinPath(provider)
  if (await fileExists(managed)) {
    return {
      binaryPath: managed,
      managed: true,
      version: await readManagedVersion(provider),
    }
  }
  const systemPath = await findOnPath(provider.binaryName)
  if (systemPath) {
    return { binaryPath: systemPath, managed: false, version: null }
  }
  return { binaryPath: null, managed: false, version: null }
}

export function createLspFrameParser(onMessage: (message: string) => void): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0)
  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) break
      const headerText = buffer.slice(0, headerEnd).toString('ascii')
      const match = /Content-Length:\s*(\d+)/i.exec(headerText)
      if (!match) {
        buffer = buffer.slice(headerEnd + 4)
        continue
      }
      const length = Number(match[1])
      const bodyStart = headerEnd + 4
      if (buffer.length < bodyStart + length) break
      const body = buffer.slice(bodyStart, bodyStart + length).toString('utf8')
      buffer = buffer.slice(bodyStart + length)
      onMessage(body)
    }
  }
}

export function encodeLspFrame(message: string): string {
  return `Content-Length: ${Buffer.byteLength(message, 'utf8')}\r\n\r\n${message}`
}

interface RunningServer {
  key: string
  serverId: LspServerId
  workspaceRoot: string
  child: ChildProcessWithoutNullStreams
  lastActiveAt: number
  idleTimer: ReturnType<typeof setTimeout> | null
}

const runningServers = new Map<string, RunningServer>()
const installingServers = new Set<string>()
const installErrors = new Map<string, string>()

function serverKey(serverId: string, workspaceRoot: string): string {
  return `${serverId}::${workspaceRoot}`
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

function refreshIdleTimer(entry: RunningServer): void {
  if (entry.idleTimer) clearTimeout(entry.idleTimer)
  entry.lastActiveAt = Date.now()
  entry.idleTimer = setTimeout(() => {
    void stopLspWorkspace(entry.serverId, entry.workspaceRoot)
  }, IDLE_TIMEOUT_MS)
}

async function resolveRuntimeSpec(serverId: string): Promise<{
  binaryPath: string | null
  args: string[]
  serverName: string
}> {
  const builtin = PROVIDERS.find((p) => p.id === serverId)
  if (builtin) {
    const resolved = await resolveBinary(builtin)
    return {
      binaryPath: resolved.binaryPath,
      args: builtin.args,
      serverName: builtin.serverName,
    }
  }
  const installed = await loadInstalledRegistryServers()
  const entry = installed[serverId]
  if (entry && (await fileExists(entry.binaryPath))) {
    return {
      binaryPath: entry.binaryPath,
      args: entry.args,
      serverName: entry.binaryName,
    }
  }
  const custom = readAppSettings().customLspServers.find((c) => c.id === serverId)
  if (custom) {
    const resolvedCmd = (await fileExists(custom.command)) ? custom.command : await findOnPath(custom.command)
    return {
      binaryPath: resolvedCmd,
      args: custom.args,
      serverName: custom.label,
    }
  }
  throw new Error(`Unknown or uninstalled LSP server: ${serverId}`)
}

async function ensureRunningServer(serverId: string, workspaceRoot: string): Promise<RunningServer> {
  const key = serverKey(serverId, workspaceRoot)
  const existing = runningServers.get(key)
  if (existing && !existing.child.killed) {
    refreshIdleTimer(existing)
    return existing
  }

  await ensureShellPath()
  const spec = await resolveRuntimeSpec(serverId)
  if (!spec.binaryPath) {
    throw new Error(`${spec.serverName} is not installed`)
  }

  const child = spawn(spec.binaryPath, spec.args, {
    cwd: workspaceRoot,
    env: process.env,
    stdio: 'pipe',
  })

  const entry: RunningServer = {
    key,
    serverId,
    workspaceRoot,
    child,
    lastActiveAt: Date.now(),
    idleTimer: null,
  }
  runningServers.set(key, entry)
  refreshIdleTimer(entry)

  const parseChunk = createLspFrameParser((message) => {
    broadcast(AgentIpcChannels.LSP_MESSAGE, { workspaceRoot, serverId, message })
  })

  child.stdout.on('data', (chunk: Buffer) => {
    parseChunk(chunk)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    log.debug(`[lsp:${serverId}] ${chunk.toString('utf8').trim()}`)
  })
  child.on('exit', () => {
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    if (runningServers.get(key) === entry) {
      runningServers.delete(key)
      broadcast(AgentIpcChannels.LSP_STATUS_EVENT, { serverId })
    }
  })
  child.on('error', (err) => {
    log.warn(`[lsp:${serverId}] process error: ${err.message}`)
  })

  broadcast(AgentIpcChannels.LSP_STATUS_EVENT, { serverId })
  return entry
}

async function buildServerInfo(provider: LspProviderSpec): Promise<LspServerInfo> {
  const settings = readAppSettings()
  const resolved = await resolveBinary(provider)
  const runningWorkspaces: LspRunningWorkspace[] = []
  for (const entry of runningServers.values()) {
    if (entry.serverId === provider.id) {
      runningWorkspaces.push({
        workspaceRoot: entry.workspaceRoot,
        pid: entry.child.pid ?? null,
        lastActiveAt: entry.lastActiveAt,
      })
    }
  }
  const error = installErrors.get(provider.id) ?? null
  const installStatus = installingServers.has(provider.id)
    ? 'installing'
    : error
      ? 'error'
      : resolved.binaryPath
        ? 'installed'
        : 'not_installed'

  return {
    id: provider.id,
    label: provider.label,
    serverName: provider.serverName,
    githubRepo: provider.githubRepo ?? null,
    languages: provider.languages,
    installStatus,
    installable: provider.npmPackages.length > 0,
    installHint: provider.installHint ?? null,
    version: resolved.version,
    binaryPath: resolved.binaryPath,
    managed: resolved.managed,
    installError: error,
    enabled: settings.lspEnabledServers[provider.id] === true,
    runningWorkspaces,
  }
}

function getRunningWorkspaces(serverId: string): LspRunningWorkspace[] {
  const result: LspRunningWorkspace[] = []
  for (const entry of runningServers.values()) {
    if (entry.serverId === serverId) {
      result.push({
        workspaceRoot: entry.workspaceRoot,
        pid: entry.child.pid ?? null,
        lastActiveAt: entry.lastActiveAt,
      })
    }
  }
  return result
}

function buildRegistryServerInfo(
  entry: MasonRegistryEntry,
  installedMap: Record<string, InstalledRegistryServer>,
  settingsEnabledServers: Record<string, boolean>,
): LspServerInfo {
  const installed = installedMap[entry.id]
  const error = installErrors.get(entry.id) ?? null
  const installStatus = installingServers.has(entry.id)
    ? 'installing'
    : error
      ? 'error'
      : installed
        ? 'installed'
        : 'not_installed'

  return {
    id: entry.id,
    label: entry.label,
    serverName: entry.binaryName,
    description: entry.description,
    homepage: entry.homepage,
    sourceId: entry.sourceId,
    fromRegistry: true,
    languages: entry.languages,
    installStatus,
    installable: entry.installable,
    installHint: entry.installHint,
    version: installed?.version ?? null,
    binaryPath: installed?.binaryPath ?? null,
    managed: Boolean(installed),
    installError: error,
    enabled: settingsEnabledServers[entry.id] === true,
    runningWorkspaces: getRunningWorkspaces(entry.id),
  }
}

export { detectProjectLspLanguages } from './lsp-registry'

async function buildCustomServerInfos(
  customs: import('@superone/shared/desktop-lsp').CustomLspServerConfig[],
  enabledMap: Record<string, boolean>,
): Promise<LspServerInfo[]> {
  return Promise.all(
    customs.map(async (c) => {
      const resolvedCmd = (await fileExists(c.command)) ? c.command : await findOnPath(c.command)
      return {
        id: c.id,
        label: c.label,
        serverName: c.command,
        description: c.args.length > 0 ? `${c.command} ${c.args.join(' ')}` : c.command,
        custom: true,
        command: c.command,
        args: c.args,
        languages: c.languages,
        installStatus: resolvedCmd ? 'installed' : 'not_installed',
        installable: false,
        installHint: null,
        version: null,
        binaryPath: resolvedCmd,
        managed: false,
        installError: null,
        enabled: enabledMap[c.id] === true,
        runningWorkspaces: getRunningWorkspaces(c.id),
      } satisfies LspServerInfo
    }),
  )
}

export async function listLspServers(): Promise<LspServerInfo[]> {
  const settings = readAppSettings()
  const [builtins, customs] = await Promise.all([
    Promise.all(PROVIDERS.map((p) => buildServerInfo(p))),
    buildCustomServerInfos(settings.customLspServers, settings.lspEnabledServers),
  ])
  const builtinIds = new Set(builtins.map((b) => b.id))
  const installedMap = await loadInstalledRegistryServers()
  const customServers: LspServerInfo[] = []
  for (const rec of Object.values(installedMap)) {
    if (builtinIds.has(rec.id)) continue
    if (!(await fileExists(rec.binaryPath))) continue
    customServers.push({
      id: rec.id,
      label: rec.label,
      serverName: rec.binaryName,
      description: rec.description,
      homepage: rec.homepage,
      sourceId: rec.sourceId,
      fromRegistry: true,
      languages: rec.languages,
      installStatus: installingServers.has(rec.id) ? 'installing' : 'installed',
      installable: true,
      installHint: null,
      version: rec.version,
      binaryPath: rec.binaryPath,
      managed: true,
      installError: installErrors.get(rec.id) ?? null,
      enabled: settings.lspEnabledServers[rec.id] === true,
      runningWorkspaces: getRunningWorkspaces(rec.id),
    })
  }
  return [...customs, ...builtins, ...customServers]
}

export async function fetchLspRegistry(forceRefresh = false): Promise<LspServerInfo[]> {
  const settings = readAppSettings()
  const [entries, stars, builtins, customs, installedMap] = await Promise.all([
    fetchMasonLspRegistry(forceRefresh),
    readCachedGithubStars(),
    Promise.all(PROVIDERS.map((p) => buildServerInfo(p))),
    buildCustomServerInfos(settings.customLspServers, settings.lspEnabledServers),
    loadInstalledRegistryServers(),
  ])
  const builtinMap = new Map(builtins.map((b) => [b.id, b]))
  const builtinServerNames = new Map(builtins.map((b) => [b.serverName, b]))
  const registryInfos = entries.map((entry) => {
    const matchedBuiltin = builtinMap.get(entry.id) ?? builtinServerNames.get(entry.binaryName)
    const githubRepo = entry.githubRepo ?? extractGithubRepo(entry.sourceId, entry.homepage)
    const githubStars = githubRepo && typeof stars[githubRepo] === 'number' ? stars[githubRepo] : null
    if (matchedBuiltin) {
      return {
        ...matchedBuiltin,
        description: entry.description || matchedBuiltin.description,
        homepage: entry.homepage ?? matchedBuiltin.homepage,
        sourceId: entry.sourceId,
        githubRepo,
        githubStars,
      }
    }
    return {
      ...buildRegistryServerInfo(entry, installedMap, settings.lspEnabledServers),
      githubRepo,
      githubStars,
    }
  })
  return [...customs, ...registryInfos]
}

export async function fetchLspGithubStars(
  repos: string[],
  forceRefresh = false,
): Promise<{ hasGh: boolean; stars: Record<string, number> }> {
  await ensureShellPath()
  return fetchGithubStarsForRepos(repos, forceRefresh)
}

async function installFromMasonEntry(entry: MasonRegistryEntry): Promise<void> {
  if (!entry.installable || !entry.packageName) {
    throw new Error(entry.installHint ?? `${entry.binaryName} must be installed manually`)
  }
  const targetDir = managedServerDir(entry.id)
  await mkdir(targetDir, { recursive: true })
  const ext = process.platform === 'win32' ? '.cmd' : ''
  let binaryPath = ''

  if (entry.purlType === 'npm') {
    const npmBin = await findOnPath(process.platform === 'win32' ? 'npm.cmd' : 'npm')
    if (!npmBin) throw new Error('npm was not found on PATH')
    await execAsync(npmBin, ['install', '--prefix', targetDir, '--no-save', '--no-audit', '--no-fund', entry.packageName])
    binaryPath = join(targetDir, 'node_modules', '.bin', `${entry.binaryName}${ext}`)
  } else if (entry.purlType === 'pypi') {
    const pythonBin = await findOnPath(process.platform === 'win32' ? 'python' : 'python3')
    if (!pythonBin) throw new Error('python3 was not found on PATH')
    const venvDir = join(targetDir, 'venv')
    await execAsync(pythonBin, ['-m', 'venv', venvDir])
    const pipBin = join(venvDir, process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'pip.exe' : 'pip')
    await execAsync(pipBin, ['install', '--upgrade', entry.packageName])
    binaryPath = join(venvDir, process.platform === 'win32' ? 'Scripts' : 'bin', `${entry.binaryName}${process.platform === 'win32' ? '.exe' : ''}`)
  } else if (entry.purlType === 'golang') {
    const goBin = await findOnPath('go')
    if (!goBin) throw new Error('go was not found on PATH')
    const binDir = join(targetDir, 'bin')
    await mkdir(binDir, { recursive: true })
    await execAsync(goBin, ['install', `${entry.packageName}@latest`], undefined, { GOBIN: binDir })
    binaryPath = join(binDir, `${entry.binaryName}${process.platform === 'win32' ? '.exe' : ''}`)
  } else if (entry.purlType === 'cargo') {
    const cargoBin = await findOnPath('cargo')
    if (!cargoBin) throw new Error('cargo was not found on PATH')
    await execAsync(cargoBin, ['install', '--root', targetDir, entry.packageName])
    binaryPath = join(targetDir, 'bin', `${entry.binaryName}${process.platform === 'win32' ? '.exe' : ''}`)
  } else {
    throw new Error(`Unsupported package type: ${entry.purlType}`)
  }

  if (!(await fileExists(binaryPath))) {
    throw new Error(`Installed ${entry.id}, but binary ${entry.binaryName} was not found`)
  }

  const installedMap = await loadInstalledRegistryServers()
  installedMap[entry.id] = {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    homepage: entry.homepage,
    languages: entry.languages,
    sourceId: entry.sourceId,
    binaryName: entry.binaryName,
    binaryPath,
    args: entry.args,
    version: null,
  }
  await saveInstalledRegistryServers(installedMap)
}

export async function installLspServer(serverId: string): Promise<LspServerInfo> {
  const builtin = PROVIDERS.find((p) => p.id === serverId)
  if (builtin) {
    if (builtin.npmPackages.length === 0) {
      throw new Error(builtin.installHint ?? `${builtin.serverName} must be installed manually`)
    }
    if (installingServers.has(serverId)) {
      return buildServerInfo(builtin)
    }

    installingServers.add(serverId)
    installErrors.delete(serverId)
    broadcast(AgentIpcChannels.LSP_STATUS_EVENT, { serverId })

    try {
      await ensureShellPath()
      const targetDir = managedServerDir(serverId)
      await mkdir(targetDir, { recursive: true })
      const npmBin = await findOnPath(process.platform === 'win32' ? 'npm.cmd' : 'npm')
      if (!npmBin) {
        throw new Error('npm was not found on PATH')
      }
      await execAsync(npmBin, ['install', '--prefix', targetDir, '--no-save', '--no-audit', '--no-fund', ...builtin.npmPackages])
    } catch (err) {
      installErrors.set(serverId, err instanceof Error ? err.message : String(err))
    } finally {
      installingServers.delete(serverId)
      broadcast(AgentIpcChannels.LSP_STATUS_EVENT, { serverId })
    }

    return buildServerInfo(builtin)
  }

  const entries = await fetchMasonLspRegistry(false)
  const entry = entries.find((e) => e.id === serverId)
  if (!entry) {
    throw new Error(`Unknown LSP server: ${serverId}`)
  }

  installingServers.add(serverId)
  installErrors.delete(serverId)
  broadcast(AgentIpcChannels.LSP_STATUS_EVENT, { serverId })

  try {
    await ensureShellPath()
    await installFromMasonEntry(entry)
  } catch (err) {
    installErrors.set(serverId, err instanceof Error ? err.message : String(err))
  } finally {
    installingServers.delete(serverId)
    broadcast(AgentIpcChannels.LSP_STATUS_EVENT, { serverId })
  }

  const installedMap = await loadInstalledRegistryServers()
  return buildRegistryServerInfo(entry, installedMap, readAppSettings().lspEnabledServers)
}

export async function uninstallLspServer(serverId: string): Promise<LspServerInfo> {
  for (const entry of Array.from(runningServers.values())) {
    if (entry.serverId === serverId) {
      await stopLspWorkspace(serverId, entry.workspaceRoot)
    }
  }
  installErrors.delete(serverId)
  await rm(managedServerDir(serverId), { recursive: true, force: true })

  const builtin = PROVIDERS.find((p) => p.id === serverId)
  if (builtin) {
    broadcast(AgentIpcChannels.LSP_STATUS_EVENT, { serverId })
    return buildServerInfo(builtin)
  }

  const installedMap = await loadInstalledRegistryServers()
  delete installedMap[serverId]
  await saveInstalledRegistryServers(installedMap)
  broadcast(AgentIpcChannels.LSP_STATUS_EVENT, { serverId })

  const entries = await fetchMasonLspRegistry(false).catch(() => [] as MasonRegistryEntry[])
  const entry = entries.find((e) => e.id === serverId)
  if (entry) {
    return buildRegistryServerInfo(entry, installedMap, readAppSettings().lspEnabledServers)
  }
  return {
    id: serverId,
    label: serverId,
    serverName: serverId,
    languages: [],
    installStatus: 'not_installed',
    installable: true,
    installHint: null,
    version: null,
    binaryPath: null,
    managed: false,
    installError: null,
    enabled: false,
    runningWorkspaces: [],
  }
}

export async function stopLspWorkspace(serverId: string, workspaceRoot: string): Promise<void> {
  const key = serverKey(serverId, workspaceRoot)
  const entry = runningServers.get(key)
  if (!entry) return
  if (entry.idleTimer) clearTimeout(entry.idleTimer)
  runningServers.delete(key)
  try {
    entry.child.kill()
  } catch {
  }
  broadcast(AgentIpcChannels.LSP_STATUS_EVENT, { serverId })
}

export async function sendLspMessage(serverId: string, workspaceRoot: string, message: string): Promise<void> {
  const entry = await ensureRunningServer(serverId, workspaceRoot)
  refreshIdleTimer(entry)
  entry.child.stdin.write(encodeLspFrame(message))
}

export function disposeAllLspServers(): void {
  for (const entry of runningServers.values()) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    try {
      entry.child.kill()
    } catch {
    }
  }
  runningServers.clear()
}
