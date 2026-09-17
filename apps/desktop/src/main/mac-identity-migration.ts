import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, net, shell } from 'electron'
import type { UpdateEvent } from '@superone/shared/agent-types'
import { macUpdateManifestUrl, type DownloadArch } from '@superone/shared/download-links'
import log from './logger'
import { variant } from './variant'

/**
 * The macOS bundle-id bridge.
 *
 * A bridge build is the last release packaged under the retired bundle id
 * (`legacyMacAppId`). Old-id clients reach it through Squirrel as usual; from
 * here on Squirrel is useless, because it validates every update against the
 * running app's designated requirement, which names the old id. So instead of
 * the updater this module offers the new-id build for a manual install:
 * fetch the new-id manifest, download the matching installer into ~/Downloads,
 * verify its sha512, then mount it and quit so the user can drag it over the
 * old app. Deliberately no self-install: this is the last old-id version and
 * a bug here has no second chance, so the one piece of high-risk code — the
 * swap — stays with Finder.
 *
 * Nothing under userData moves (it is keyed by productName), so the new app
 * finds every session, project and setting where it left them.
 */

type ManifestFile = { url: string; sha512: string; size?: number }
type Manifest = { version: string; files: ManifestFile[] }

type Emit = (event: UpdateEvent) => void

let emit: Emit = () => {}
let target: { version: string; url: string; sha512: string; fileName: string } | null = null
let downloadedPath: string | null = null
let inFlight: Promise<void> | null = null
let quittingForInstall = false

/** True after the user chose to open the installer: `before-quit` must not confirm. */
export function isQuittingForMigrationInstall(): boolean {
  return quittingForInstall
}

/** Pure YAML subset parser for electron-builder's channel manifests, exported for tests. */
export function parseManifest(text: string): Manifest {
  const version = text.match(/^version:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  if (!version) throw new Error('manifest has no version')
  const files: ManifestFile[] = []
  const filesBlock = text.match(/^files:\n((?:[ \t]+.*\n?)+)/m)?.[1] ?? ''
  for (const entry of filesBlock.split(/^\s*-\s+/m).slice(1)) {
    const url = entry.match(/url:\s*(.+)/)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
    const sha512 = entry.match(/sha512:\s*(.+)/)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
    const size = Number(entry.match(/size:\s*(\d+)/)?.[1])
    if (url && sha512) files.push({ url, sha512, ...(Number.isFinite(size) && { size }) })
  }
  return { version, files }
}

/** The installer for this machine, exported for tests. Rosetta hosts get the native build. */
export function pickInstaller(manifest: Manifest, arch: DownloadArch): ManifestFile | null {
  return manifest.files.find((f) => f.url.toLowerCase().endsWith(`-${arch}.dmg`)) ?? null
}

function hostArch(): DownloadArch {
  return process.arch === 'arm64' || app.runningUnderARM64Translation ? 'arm64' : 'x64'
}

async function sha512Of(path: string): Promise<string> {
  const hash = createHash('sha512')
  hash.update(await readFile(path))
  return hash.digest('base64')
}

async function fetchTarget(): Promise<NonNullable<typeof target>> {
  if (target) return target
  const prefix = variant().downloadPrefix
  if (!prefix) throw new Error('this variant publishes no downloads')
  // Test seam: point a packaged bridge build at a local server that mimics
  // the R2 layout (`<base>/<prefix>/desktop-mac.yml`, `<base>/<prefix>/v<version>/...`).
  const manifestUrl = macUpdateManifestUrl(prefix, process.env.SUPERONE_MIGRATION_BASE_URL || undefined)
  const res = await net.fetch(manifestUrl, { cache: 'no-store' })
  if (!res.ok) throw new Error(`manifest ${manifestUrl}: HTTP ${res.status}`)
  const manifest = parseManifest(await res.text())
  const file = pickInstaller(manifest, hostArch())
  if (!file) throw new Error(`manifest ${manifest.version} has no ${hostArch()} installer`)
  target = {
    version: manifest.version,
    url: new URL(file.url, `${manifestUrl.slice(0, manifestUrl.lastIndexOf('/'))}/`).toString(),
    sha512: file.sha512,
    fileName: basename(file.url),
  }
  return target
}

/**
 * Announce the bridge to the renderer. Reads the manifest so the dialog can
 * name the version; a network failure still surfaces the requirement, just
 * without one.
 */
export async function initIdentityMigration(emitEvent: Emit): Promise<void> {
  emit = emitEvent
  log.info(`[identity-migration] running under retired bundle id; new id is ${variant().macAppId}`)
  emit({ type: 'identity-migration', stage: 'required', version: null })
  try {
    const t = await fetchTarget()
    emit({ type: 'identity-migration', stage: 'required', version: t.version })
  } catch (err) {
    log.warn('[identity-migration] manifest fetch failed:', err instanceof Error ? err.message : String(err))
  }
}

export function downloadNewIdentityInstaller(): void {
  if (inFlight) return
  inFlight = (async () => {
    let t: NonNullable<typeof target> | null = null
    try {
      t = await fetchTarget()
      const dir = app.getPath('downloads')
      await mkdir(dir, { recursive: true })
      const finalPath = join(dir, t.fileName)

      // An earlier, verified download is reused rather than re-fetched.
      if (await stat(finalPath).catch(() => null)) {
        if ((await sha512Of(finalPath)) === t.sha512) {
          downloadedPath = finalPath
          emit({ type: 'identity-migration', stage: 'downloaded', version: t.version, path: finalPath })
          return
        }
        await rm(finalPath, { force: true })
      }

      emit({ type: 'identity-migration', stage: 'downloading', version: t.version, percent: 0 })
      const res = await net.fetch(t.url, { cache: 'no-store' })
      if (!res.ok || !res.body) throw new Error(`installer ${t.url}: HTTP ${res.status}`)
      const total = Number(res.headers.get('content-length')) || 0
      let received = 0
      let lastPercent = -1
      const hash = createHash('sha512')
      const partPath = `${finalPath}.part`
      const progress = new TransformStreamProgress((chunk) => {
        hash.update(chunk)
        received += chunk.length
        const percent = total ? Math.min(99, Math.floor((received / total) * 100)) : 0
        if (percent !== lastPercent) {
          lastPercent = percent
          emit({ type: 'identity-migration', stage: 'downloading', version: t!.version, percent })
        }
      })
      await pipeline(Readable.fromWeb(res.body as never), progress, createWriteStream(partPath))
      if (hash.digest('base64') !== t.sha512) {
        await rm(partPath, { force: true })
        throw new Error('downloaded installer failed sha512 verification')
      }
      await rename(partPath, finalPath)
      downloadedPath = finalPath
      log.info(`[identity-migration] downloaded ${finalPath}`)
      emit({ type: 'identity-migration', stage: 'downloaded', version: t.version, path: finalPath })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('[identity-migration] download failed:', message)
      emit({ type: 'identity-migration', stage: 'error', version: t?.version ?? null, message })
    } finally {
      inFlight = null
    }
  })()
}

/** Mount the downloaded image and quit so Finder can replace the running bundle. */
export async function openNewIdentityInstallerAndQuit(): Promise<void> {
  if (!downloadedPath) return
  const error = await shell.openPath(downloadedPath)
  if (error) {
    emit({ type: 'identity-migration', stage: 'error', version: target?.version ?? null, message: error })
    return
  }
  quittingForInstall = true
  // Give the mount a moment to surface its window before this one disappears.
  setTimeout(() => app.quit(), 1500)
}

export function revealNewIdentityInstaller(): void {
  if (downloadedPath) shell.showItemInFolder(downloadedPath)
}

/** Minimal pass-through Transform that reports each chunk; kept local to avoid a dependency. */
class TransformStreamProgress extends Transform {
  constructor(private readonly onChunk: (chunk: Buffer) => void) {
    super()
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: (error?: Error | null, data?: Buffer) => void): void {
    this.onChunk(chunk)
    cb(null, chunk)
  }
}

/** Test seam: forget cached manifest / download state. */
export function resetIdentityMigrationForTests(): void {
  target = null
  downloadedPath = null
  inFlight = null
  quittingForInstall = false
  emit = () => {}
}
