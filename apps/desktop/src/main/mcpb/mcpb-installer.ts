import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, rm, readFile, writeFile, readdir, cp } from 'fs/promises'
import { tmpdir, homedir } from 'os'
import { join, relative, resolve, sep } from 'path'
import { Extract as unzipExtract } from 'unzipper'
import { app, shell } from 'electron'
import log from '../logger'
import { saveMcpConfig, deleteMcpConfig } from '../mcp-config-service'
import { saveCodexMcpConfig, deleteCodexMcpConfig } from '../codex-config-service'
import { addBundleLibraryEntry } from '../mcp-library-service'
import type { McpbProvider } from '@superone/shared/mcpb-types'
import { parseMcpbManifest } from './mcpb-manifest-schema'
import { checkRuntimeAvailable, resolveMcpbServer } from './mcpb-runtime'
import { writeSecrets, clearSecrets } from './mcpb-secrets'
import type {
  McpbInstallMeta,
  McpbInstallRequest,
  McpbInstalledEntry,
  McpbManifest,
  McpbPreview,
  McpbUserConfigValues,
} from '@superone/shared/mcpb-types'

export type {
  McpbInstallMeta,
  McpbInstallRequest,
  McpbInstalledEntry,
  McpbPreview,
} from '@superone/shared/mcpb-types'

const MANIFEST_FILE = 'manifest.json'
const INSTALL_META_FILE = 'install.json'
const ICON_DATA_LIMIT_BYTES = 512 * 1024

export interface InstallerPaths {
  rootDir: string
  tempBaseDir: string
}

function defaultPaths(): InstallerPaths {
  const home = (() => {
    try { return app.getPath('home') } catch { return homedir() }
  })()
  const temp = (() => {
    try { return app.getPath('temp') } catch { return tmpdir() }
  })()
  return {
    rootDir: join(home, '.superone', 'mcpb'),
    tempBaseDir: temp,
  }
}

function installDirOf(rootDir: string, name: string, version: string): string {
  return join(rootDir, `${name}@${version}`)
}

function assertSafeInstallDir(rootDir: string, name: string, version: string): void {
  const target = resolve(installDirOf(rootDir, name, version))
  const root = resolve(rootDir)
  const rel = relative(root, target)
  if (rel === '' || rel.startsWith('..') || rel.includes(sep)) {
    throw new Error(`Manifest name "${name}" would escape install root`)
  }
}

function sha256Hex(input: string | Buffer): string {
  const h = createHash('sha256')
  h.update(input)
  return h.digest('hex')
}

async function unzipTo(sourceFile: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    createReadStream(sourceFile)
      .pipe(unzipExtract({ path: destDir }))
      .on('close', resolve)
      .on('error', reject)
  })
}

async function readManifestFromDir(
  dir: string,
): Promise<{ manifest: McpbManifest; manifestHash: string; raw: string }> {
  const manifestPath = join(dir, MANIFEST_FILE)
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in bundle`)
  }
  const raw = await readFile(manifestPath, 'utf-8')
  const parsed = parseMcpbManifest(JSON.parse(raw))
  if (!parsed.ok || !parsed.manifest) {
    throw new Error(`Invalid manifest:\n${parsed.errors.join('\n')}`)
  }
  return { manifest: parsed.manifest, manifestHash: sha256Hex(raw), raw }
}

async function loadIconDataUrl(dir: string, manifest: McpbManifest): Promise<string | undefined> {
  if (!manifest.icon) return undefined
  const iconPath = join(dir, manifest.icon)
  if (!existsSync(iconPath)) return undefined
  const buf = await readFile(iconPath)
  if (buf.byteLength > ICON_DATA_LIMIT_BYTES) return undefined
  const ext = manifest.icon.split('.').pop()?.toLowerCase() ?? 'png'
  const mime = ext === 'svg' ? 'image/svg+xml'
    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
    : 'image/png'
  return `data:${mime};base64,${buf.toString('base64')}`
}

async function findExistingInstall(
  rootDir: string,
  name: string,
): Promise<{ version: string; dir: string } | undefined> {
  if (!existsSync(rootDir)) return undefined
  let entries: string[]
  try {
    entries = await readdir(rootDir)
  } catch {
    return undefined
  }
  for (const entry of entries) {
    if (!entry.startsWith(`${name}@`)) continue
    const dir = join(rootDir, entry)
    const metaPath = join(dir, INSTALL_META_FILE)
    if (!existsSync(metaPath)) continue
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf-8')) as McpbInstallMeta
      if (meta.name === name) return { version: meta.version, dir }
    } catch { /* skip malformed */ }
  }
  return undefined
}

function isPlatformSupported(manifest: McpbManifest): boolean {
  const platforms = manifest.compatibility?.platforms
  if (!platforms || platforms.length === 0) return true
  return platforms.includes(process.platform as 'darwin' | 'win32' | 'linux')
}

export async function previewMcpbBundle(
  filePath: string,
  paths: InstallerPaths = defaultPaths(),
): Promise<McpbPreview> {
  const tmpDir = await mkdtemp(join(paths.tempBaseDir, 'mcpb-preview-'))
  try {
    await unzipTo(filePath, tmpDir)
    const { manifest, manifestHash } = await readManifestFromDir(tmpDir)
    assertSafeInstallDir(paths.rootDir, manifest.name, manifest.version)

    const platformSupported = isPlatformSupported(manifest)
    const runtime = await checkRuntimeAvailable(manifest.server.type)
    const iconDataUrl = await loadIconDataUrl(tmpDir, manifest)

    const existing = await findExistingInstall(paths.rootDir, manifest.name)
    const conflictsWith = existing
      ? { name: manifest.name, existingVersion: existing.version, sameVersion: existing.version === manifest.version }
      : undefined

    const warnings: string[] = []
    if (!platformSupported) {
      warnings.push(`This bundle does not support ${process.platform}.`)
    }
    if (!runtime.ok && runtime.hint) warnings.push(runtime.hint)

    return { manifest, manifestHash, iconDataUrl, runtime, conflictsWith, warnings, platformSupported }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

function partitionUserConfig(
  manifest: McpbManifest,
  userConfig: McpbUserConfigValues,
): { plain: McpbUserConfigValues; sensitive: Record<string, string>; sensitiveKeys: string[] } {
  const plain: McpbUserConfigValues = {}
  const sensitive: Record<string, string> = {}
  const sensitiveKeys: string[] = []
  for (const [key, field] of Object.entries(manifest.user_config)) {
    if (!(key in userConfig)) continue
    if (field.sensitive) {
      sensitive[key] = String(userConfig[key])
      sensitiveKeys.push(key)
    } else {
      plain[key] = userConfig[key]
    }
  }
  return { plain, sensitive, sensitiveKeys }
}

export async function installMcpbBundle(
  req: McpbInstallRequest,
  paths: InstallerPaths = defaultPaths(),
): Promise<McpbInstalledEntry> {
  const tmpDir = await mkdtemp(join(paths.tempBaseDir, 'mcpb-install-'))
  let installed = false
  try {
    await unzipTo(req.filePath, tmpDir)
    const { manifest, manifestHash } = await readManifestFromDir(tmpDir)
    assertSafeInstallDir(paths.rootDir, manifest.name, manifest.version)

    if (req.scope === 'project' && !req.cwd) {
      throw new Error('Project scope requires an open project directory.')
    }

    if (manifestHash !== req.expectedManifestHash) {
      throw new Error('Bundle manifest changed since preview. Please re-add the .mcpb file.')
    }
    if (!isPlatformSupported(manifest)) {
      throw new Error(`Bundle does not support ${process.platform}`)
    }
    const runtime = await checkRuntimeAvailable(manifest.server.type)
    if (!runtime.ok) {
      throw new Error(runtime.hint ?? `Required runtime (${manifest.server.type}) is not available.`)
    }

    const installDir = installDirOf(paths.rootDir, manifest.name, manifest.version)

    const existing = await findExistingInstall(paths.rootDir, manifest.name)
    if (existing && existing.dir !== installDir) {
      await rm(existing.dir, { recursive: true, force: true })
    }
    if (existsSync(installDir)) {
      await rm(installDir, { recursive: true, force: true })
    }
    await mkdir(installDir, { recursive: true })
    await cp(tmpDir, installDir, { recursive: true })

    const { plain, sensitive, sensitiveKeys } = partitionUserConfig(manifest, req.userConfig)

    if (sensitiveKeys.length > 0) {
      await writeSecrets(installDir, sensitive)
    }

    const meta: McpbInstallMeta = {
      name: manifest.name,
      version: manifest.version,
      installedAt: new Date().toISOString(),
      provider: req.provider,
      scope: req.scope,
      cwd: req.cwd,
      manifestHash,
      userConfigPlain: plain,
      userConfigSensitiveKeys: sensitiveKeys,
    }
    await writeFile(join(installDir, INSTALL_META_FILE), JSON.stringify(meta, null, 2))
    installed = true

    const allUserConfig: McpbUserConfigValues = { ...plain, ...sensitive }
    const resolved = resolveMcpbServer({ manifest, installDir, userConfig: allUserConfig })

    const writeConfig = req.provider === 'codex' ? saveCodexMcpConfig : saveMcpConfig
    writeConfig(
      manifest.name,
      { type: 'stdio', command: resolved.command, args: resolved.args, env: resolved.env },
      req.scope,
      req.cwd ?? '',
    )

    const iconDataUrl = await loadIconDataUrl(installDir, manifest)
    addBundleLibraryEntry({
      name: manifest.name,
      bundleVersion: manifest.version,
      command: resolved.command,
      args: resolved.args,
      env: resolved.env,
      description: manifest.description,
      iconDataUrl,
    })

    log.info('[mcpb] installed %s@%s provider=%s scope=%s -> %s', manifest.name, manifest.version, req.provider, req.scope, installDir)

    return { meta, installDir, iconDataUrl }
  } catch (err) {
    if (!installed) throw err
    throw err
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

export async function uninstallMcpbBundle(
  name: string,
  paths: InstallerPaths = defaultPaths(),
): Promise<void> {
  const existing = await findExistingInstall(paths.rootDir, name)
  if (!existing) return

  const metaPath = join(existing.dir, INSTALL_META_FILE)
  let meta: McpbInstallMeta | undefined
  try {
    meta = JSON.parse(await readFile(metaPath, 'utf-8')) as McpbInstallMeta
  } catch { /* ignore */ }

  if (meta) {
    const resolvedMeta = meta
    const provider: McpbProvider = resolvedMeta.provider ?? 'claude'
    const deleteFn = provider === 'codex' ? deleteCodexMcpConfig : deleteMcpConfig
    deleteFn(resolvedMeta.name, resolvedMeta.scope, resolvedMeta.cwd ?? '')
    const otherDeleteFn = provider === 'codex' ? deleteMcpConfig : deleteCodexMcpConfig
    otherDeleteFn(resolvedMeta.name, 'user', '')
  }

  await clearSecrets(existing.dir)
  await rm(existing.dir, { recursive: true, force: true })

  log.info('[mcpb] uninstalled %s', name)
}

export async function listInstalledMcpb(
  paths: InstallerPaths = defaultPaths(),
): Promise<McpbInstalledEntry[]> {
  if (!existsSync(paths.rootDir)) return []
  let entries: string[]
  try {
    entries = await readdir(paths.rootDir)
  } catch {
    return []
  }
  const results: McpbInstalledEntry[] = []
  for (const entry of entries) {
    const dir = join(paths.rootDir, entry)
    const metaPath = join(dir, INSTALL_META_FILE)
    if (!existsSync(metaPath)) continue
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf-8')) as McpbInstallMeta
      let iconDataUrl: string | undefined
      try {
        const { manifest } = await readManifestFromDir(dir)
        iconDataUrl = await loadIconDataUrl(dir, manifest)
      } catch { /* missing/invalid manifest — skip icon */ }
      results.push({ meta, installDir: dir, iconDataUrl })
    } catch { /* skip malformed */ }
  }
  return results.sort((a, b) => a.meta.name.localeCompare(b.meta.name))
}

export async function revealMcpbBundle(
  name: string,
  paths: InstallerPaths = defaultPaths(),
): Promise<void> {
  const existing = await findExistingInstall(paths.rootDir, name)
  if (!existing) throw new Error(`Bundle "${name}" is not installed`)
  shell.showItemInFolder(existing.dir)
}
