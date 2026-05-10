import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { readdir, readFile, writeFile, rm, stat, mkdir, cp } from 'fs/promises'
import { basename, dirname, join, relative } from 'path'
import archiver from 'archiver'
import { app } from 'electron'
import log from '../logger'
import { extractZip } from '../zip-utils'
import { parseManifest } from './miniapp-schema'
import { closeDbForApp } from './miniapp-db'
import type { MiniAppInstallMeta, MiniAppInstallResult, MiniAppIntegrity, MiniAppManifest, MiniAppPackResult, MiniAppPreviewResult } from '@superone/shared/miniapp-types'

const INTEGRITY_FILE = 'integrity.json'
const INSTALL_META_FILE = 'install.json'
const PREAPPROVED_FILE = 'preapproved.json'
const S1APP_EXT = '.s1app'

const userAppsDir = () => join(app.getPath('home'), '.superone', 'apps')

async function collectFiles(dir: string, base?: string): Promise<string[]> {
  const root = base ?? dir
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full, root)))
    } else {
      files.push(relative(root, full))
    }
  }
  return files
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export async function generateIntegrity(appDir: string): Promise<MiniAppIntegrity> {
  const allFiles = await collectFiles(appDir)
  const files: Record<string, string> = {}
  for (const rel of allFiles) {
    if (rel === INTEGRITY_FILE || rel === INSTALL_META_FILE || rel === PREAPPROVED_FILE) continue
    const data = await readFile(join(appDir, rel))
    files[rel] = sha256(data)
  }
  return { files }
}

export async function verifyIntegrity(appDir: string): Promise<{ ok: boolean; errors: string[] }> {
  const integrityPath = join(appDir, INTEGRITY_FILE)
  let integrity: MiniAppIntegrity
  try {
    integrity = JSON.parse(await readFile(integrityPath, 'utf-8'))
  } catch {
    return { ok: false, errors: ['integrity.json not found or invalid'] }
  }

  const errors: string[] = []
  for (const [rel, expectedHash] of Object.entries(integrity.files)) {
    try {
      const data = await readFile(join(appDir, rel))
      const actual = sha256(data)
      if (actual !== expectedHash) {
        errors.push(`hash mismatch: ${rel}`)
      }
    } catch {
      errors.push(`missing file: ${rel}`)
    }
  }

  const currentFiles = await collectFiles(appDir)
  for (const rel of currentFiles) {
    if (rel === INTEGRITY_FILE || rel === INSTALL_META_FILE || rel === PREAPPROVED_FILE) continue
    if (!(rel in integrity.files)) {
      errors.push(`unexpected file: ${rel}`)
    }
  }

  return { ok: errors.length === 0, errors }
}

export async function packApp(appDir: string, outputDir: string): Promise<MiniAppPackResult> {
  const raw = await readFile(join(appDir, 'manifest.json'), 'utf-8')
  const parsed = parseManifest(JSON.parse(raw))
  if (!parsed.ok) {
    throw new Error(`Invalid manifest:\n${parsed.errors.join('\n')}`)
  }
  const manifest = parsed.manifest as MiniAppManifest

  if (!manifest.version) {
    throw new Error('manifest.version is required for packaging')
  }

  const tmpDir = join(app.getPath('temp'), `s1app-pack-${Date.now()}`)
  await cp(appDir, tmpDir, { recursive: true })

  try {
    const tmpManifestRaw = await readFile(join(tmpDir, 'manifest.json'), 'utf-8')
    const cleanManifest = JSON.parse(tmpManifestRaw)
    delete cleanManifest.isDev
    await writeFile(join(tmpDir, 'manifest.json'), JSON.stringify(cleanManifest, null, 2))

    const integrity = await generateIntegrity(tmpDir)
    await writeFile(join(tmpDir, INTEGRITY_FILE), JSON.stringify(integrity, null, 2))

    const outputPath = join(outputDir, `${manifest.appId}-${manifest.version}${S1APP_EXT}`)
    await mkdir(outputDir, { recursive: true })

    return await new Promise((resolve, reject) => {
      const output = createWriteStream(outputPath)
      const archive = archiver('zip', { zlib: { level: 9 } })

      output.on('close', () => {
        resolve({
          outputPath,
          manifest,
          fileCount: Object.keys(integrity.files).length + 1,
        })
      })

      archive.on('error', reject)
      archive.pipe(output)
      archive.glob('**/*', { cwd: tmpDir, ignore: [PREAPPROVED_FILE, INSTALL_META_FILE] })
      archive.finalize()
    })
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

export async function previewApp(s1appPath: string): Promise<MiniAppPreviewResult> {
  const tmpDir = join(app.getPath('temp'), `s1app-install-${Date.now()}`)

  try {
    await extractZip(s1appPath, tmpDir)

    const raw = await readFile(join(tmpDir, 'manifest.json'), 'utf-8')
    const parsed = parseManifest(JSON.parse(raw))
    if (!parsed.ok) {
      throw new Error(`Invalid manifest in package:\n${parsed.errors.join('\n')}`)
    }
    const manifest = parsed.manifest as MiniAppManifest

    if (!manifest.version) {
      throw new Error('manifest.version is required for installation')
    }

    const integrityResult = await verifyIntegrity(tmpDir)
    if (!integrityResult.ok) {
      throw new Error(`Integrity check failed:\n${integrityResult.errors.join('\n')}`)
    }

    let existingVersion: string | undefined
    try {
      const existingMeta = JSON.parse(
        await readFile(join(userAppsDir(), manifest.appId, INSTALL_META_FILE), 'utf-8'),
      ) as MiniAppInstallMeta
      existingVersion = existingMeta.version
    } catch { /* not installed */ }

    return { manifest, tempDir: tmpDir, existingVersion }
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true })
    throw err
  }
}

export async function confirmInstall(tempDir: string, installDir?: string, preapprovedTools?: string[]): Promise<MiniAppInstallResult> {
  try {
    const raw = await readFile(join(tempDir, 'manifest.json'), 'utf-8')
    const manifest = JSON.parse(raw) as MiniAppManifest

    const targetDir = join(installDir ?? userAppsDir(), manifest.appId)
    let upgraded = false

    try {
      const existingMeta = JSON.parse(
        await readFile(join(targetDir, INSTALL_META_FILE), 'utf-8'),
      ) as MiniAppInstallMeta
      upgraded = existingMeta.version !== manifest.version
    } catch { /* not installed */ }

    if (upgraded) {
      await clearTargetPreservingUserData(targetDir)
    }

    await mkdir(targetDir, { recursive: true })
    await cp(tempDir, targetDir, { recursive: true })

    const meta: MiniAppInstallMeta = {
      appId: manifest.appId,
      version: manifest.version!,
      installedAt: new Date().toISOString(),
      source: 'local',
      integrityVerified: true,
    }
    await writeFile(join(targetDir, INSTALL_META_FILE), JSON.stringify(meta, null, 2))
    if (preapprovedTools?.length) {
      await writeFile(join(targetDir, PREAPPROVED_FILE), JSON.stringify({ tools: preapprovedTools }, null, 2))
    }

    log.info('[miniapp] installed %s@%s → %s', manifest.appId, manifest.version, targetDir)

    return {
      entry: { id: manifest.appId, manifest, installDir: targetDir },
      meta,
      upgraded,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function clearTargetPreservingUserData(targetDir: string): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(targetDir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name.startsWith('.s1-') || name === 'data') continue
    await rm(join(targetDir, name), { recursive: true, force: true })
  }
}

export async function cancelInstall(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true })
}

export async function uninstallApp(appId: string): Promise<void> {
  const targetDir = join(userAppsDir(), appId)
  if (!(await dirExists(targetDir))) {
    throw new Error(`App not installed: ${appId}`)
  }
  closeDbForApp(appId)
  await rm(targetDir, { recursive: true, force: true })
  log.info('[miniapp] uninstalled %s', appId)
}

export async function getInstallMeta(appId: string): Promise<MiniAppInstallMeta | null> {
  try {
    const raw = await readFile(join(userAppsDir(), appId, INSTALL_META_FILE), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function getPreapproved(appId: string): Promise<string[]> {
  return getPreapprovedByPath(join(userAppsDir(), appId))
}

export async function getPreapprovedByPath(basePath: string): Promise<string[]> {
  try {
    const raw = await readFile(join(basePath, PREAPPROVED_FILE), 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data?.tools) ? data.tools : []
  } catch {
    const publicDir = await resolvePublicDir(basePath)
    if (!publicDir) return []
    try {
      const raw = await readFile(join(publicDir, PREAPPROVED_FILE), 'utf-8')
      const data = JSON.parse(raw)
      return Array.isArray(data?.tools) ? data.tools : []
    } catch {
      return []
    }
  }
}

export async function setPreapproved(appId: string, tools: string[]): Promise<void> {
  return setPreapprovedByPath(join(userAppsDir(), appId), tools)
}

export async function setPreapprovedByPath(basePath: string, tools: string[]): Promise<void> {
  const json = JSON.stringify({ tools }, null, 2)
  if (tools.length === 0) {
    await rm(join(basePath, PREAPPROVED_FILE), { force: true })
  } else {
    await writeFile(join(basePath, PREAPPROVED_FILE), json)
  }
  const publicDir = await resolvePublicDir(basePath)
  if (publicDir) {
    if (tools.length === 0) {
      await rm(join(publicDir, PREAPPROVED_FILE), { force: true })
    } else {
      await writeFile(join(publicDir, PREAPPROVED_FILE), json)
    }
  }
}

async function resolvePublicDir(basePath: string): Promise<string | null> {
  if (basename(basePath) !== 'dist') return null
  const publicDir = join(dirname(basePath), 'public')
  if (!(await dirExists(publicDir))) return null
  return publicDir
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
