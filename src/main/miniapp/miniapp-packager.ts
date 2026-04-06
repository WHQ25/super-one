import { createHash } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { readdir, readFile, writeFile, rm, stat, mkdir, cp } from 'fs/promises'
import { join, relative } from 'path'
import archiver from 'archiver'
import { Extract as unzipExtract } from 'unzipper'
import { app } from 'electron'
import log from '../logger'
import { parseManifest } from './miniapp-schema'
import type { MiniAppInstallMeta, MiniAppInstallResult, MiniAppIntegrity, MiniAppManifest, MiniAppPackResult } from '../../shared/miniapp-types'

const INTEGRITY_FILE = 'integrity.json'
const INSTALL_META_FILE = 'install.json'
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
    if (rel === INTEGRITY_FILE || rel === INSTALL_META_FILE) continue
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
    if (rel === INTEGRITY_FILE || rel === INSTALL_META_FILE) continue
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

  const integrity = await generateIntegrity(appDir)
  await writeFile(join(appDir, INTEGRITY_FILE), JSON.stringify(integrity, null, 2))

  const outputPath = join(outputDir, `${manifest.appId}-${manifest.version}${S1APP_EXT}`)
  await mkdir(outputDir, { recursive: true })

  return new Promise((resolve, reject) => {
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
    archive.directory(appDir, false)
    archive.finalize()
  })
}

export async function installApp(s1appPath: string): Promise<MiniAppInstallResult> {
  const tmpDir = join(app.getPath('temp'), `s1app-install-${Date.now()}`)
  await mkdir(tmpDir, { recursive: true })

  try {
    await new Promise<void>((resolve, reject) => {
      createReadStream(s1appPath)
        .pipe(unzipExtract({ path: tmpDir }))
        .on('close', resolve)
        .on('error', reject)
    })

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

    const targetDir = join(userAppsDir(), manifest.appId)
    let upgraded = false

    try {
      const existingMeta = JSON.parse(
        await readFile(join(targetDir, INSTALL_META_FILE), 'utf-8'),
      ) as MiniAppInstallMeta
      upgraded = existingMeta.version !== manifest.version
    } catch {
      // no existing installation
    }

    if (upgraded || !(await dirExists(targetDir))) {
      await rm(targetDir, { recursive: true, force: true })
    }

    await mkdir(targetDir, { recursive: true })
    await cp(tmpDir, targetDir, { recursive: true })

    const meta: MiniAppInstallMeta = {
      appId: manifest.appId,
      version: manifest.version,
      installedAt: new Date().toISOString(),
      source: 'local',
      integrityVerified: true,
    }
    await writeFile(join(targetDir, INSTALL_META_FILE), JSON.stringify(meta, null, 2))

    log.info('[miniapp] installed %s@%s → %s', manifest.appId, manifest.version, targetDir)

    return {
      entry: { id: manifest.appId, manifest, basePath: targetDir },
      meta,
      upgraded,
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

export async function uninstallApp(appId: string): Promise<void> {
  const targetDir = join(userAppsDir(), appId)
  if (!(await dirExists(targetDir))) {
    throw new Error(`App not installed: ${appId}`)
  }
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

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
