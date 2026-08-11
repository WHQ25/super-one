/**
 * Managed Harness release coupling (design §13.3) — Stage 3.
 *
 * - Manifest pins exact artifact versions per CLI release (no upstream "latest").
 * - Offline `--artifact` must match platform/arch + SHA-256 of the pin.
 * - Install is atomic under `<harnessHome>/releases/<cliVersion>/harnesses/<id>/`
 *   (harnessHome = `~/.superone/harness`, shared with desktop).
 * - Network download is still deferred; without --artifact we fail with the
 *   expected digest so operators/desktop upload path can supply the file.
 *
 * Security:
 * - Path segments (cliVersion, artifactVersion) are single-segment allowlisted.
 * - Payload uses a fixed internal filename (`payload.bin`) — never trust fileName
 *   for the install path (avoids overwriting metadata / path escape).
 * - Version directories are immutable: create via rename-into-place only; never
 *   rmSync an existing version dir. Activation is via atomic pointer file.
 */

import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { arch as osArch, platform as osPlatform } from 'node:os'
import type { NodeHarnessId } from '@superone/shared/environment'

/**
 * Host-supplied release version used to pin managed artifacts. The CLI installs
 * its `resolveCliReleaseVersion` (env → esbuild define → dist MANIFEST → root
 * package.json); the desktop installs `app.getVersion()`. Falls back to the
 * `SUPERONE_CLI_VERSION` env so tests need no wiring.
 */
let releaseVersionProvider: (() => string) | null = null

export function setHarnessReleaseVersionProvider(fn: (() => string) | null): void {
  releaseVersionProvider = fn
}

export type ManagedHarnessId = 'claude' | 'codex'

export type HostPlatform = 'darwin' | 'linux' | 'windows'
export type HostArch = 'arm64' | 'x64'

/** Fixed payload name inside a versioned install directory. Never from manifest. */
export const MANAGED_PAYLOAD_BASENAME = 'payload.bin'
export const MANAGED_META_BASENAME = 'artifact.json'
export const MANAGED_CURRENT_BASENAME = 'current'

/** Max length for a single path segment used under releases/. */
const MAX_SEGMENT_LEN = 64
/** Semver-ish / product id segment: letters, digits, dot, underscore, hyphen. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export interface ManagedArtifactPin {
  platform: HostPlatform
  arch: HostArch
  /** Lowercase hex SHA-256 of the artifact bytes. */
  digestSha256: string
  /** Optional display/original name — never used as a filesystem path segment. */
  fileName?: string
  /**
   * CDN URL for the byte-exact npm tarball mirror (R2 / dl.super-one.dev).
   * When present, hosts try this before the npm registry fallback.
   */
  url?: string
  /** npm package name used for registry fallback (e.g. `@openai/codex`). */
  npmName?: string
  /** Exact npm version used for registry fallback (may include platform suffix). */
  npmVersion?: string
}

export interface ManagedHarnessPin {
  runtimeVersion: string
  artifactVersion: string
  artifacts: ManagedArtifactPin[]
}

export interface HarnessReleaseManifest {
  cliVersion: string
  managedHarnesses: Partial<Record<ManagedHarnessId, ManagedHarnessPin>>
}

export interface InstallManagedArtifactResult {
  harnessId: ManagedHarnessId
  cliVersion: string
  runtimeVersion: string
  artifactVersion: string
  digestSha256: string
  /** Absolute path to the active installed binary/payload. */
  installPath: string
  source: 'offline-artifact'
  reusedExisting: boolean
}

/**
 * Current host release version used for manifest coupling.
 * Resolution order: injected provider → `SUPERONE_CLI_VERSION` env.
 * Hosts install the provider via `setHarnessReleaseVersionProvider`.
 */
export function currentCliVersion(): string {
  const v = releaseVersionProvider?.() ?? process.env.SUPERONE_CLI_VERSION?.trim() ?? ''
  return assertSafePathSegment(v, 'cli version')
}

export function currentHostPlatform(): HostPlatform {
  const p = osPlatform()
  if (p === 'darwin') return 'darwin'
  if (p === 'linux') return 'linux'
  if (p === 'win32') return 'windows'
  throw new Error(`unsupported host platform for managed harnesses: ${p}`)
}

export function currentHostArch(): HostArch {
  const a = osArch()
  if (a === 'arm64') return 'arm64'
  if (a === 'x64') return 'x64'
  throw new Error(`unsupported host arch for managed harnesses: ${a}`)
}

export function isManagedHarnessId(id: string): id is ManagedHarnessId {
  return id === 'claude' || id === 'codex'
}

export function assertSafePathSegment(value: string, label: string): string {
  const v = value.trim()
  if (!v) throw new Error(`${label} must be non-empty`)
  if (v.length > MAX_SEGMENT_LEN) throw new Error(`${label} exceeds ${MAX_SEGMENT_LEN} chars`)
  if (v === '.' || v === '..') throw new Error(`${label} must not be '.' or '..'`)
  if (v.includes('/') || v.includes('\\') || v.includes('\0')) {
    throw new Error(`${label} must be a single path segment`)
  }
  if (!SAFE_SEGMENT.test(v)) {
    throw new Error(`${label} contains invalid characters`)
  }
  // Windows reserved device names (even on non-Windows for portable manifests).
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(v)) {
    throw new Error(`${label} is a reserved name`)
  }
  return v
}

export function parseHarnessReleaseManifest(raw: unknown): HarnessReleaseManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('release manifest must be an object')
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.cliVersion !== 'string') {
    throw new Error('release manifest missing cliVersion')
  }
  const cliVersion = assertSafePathSegment(obj.cliVersion, 'cliVersion')
  const mh = obj.managedHarnesses
  if (!mh || typeof mh !== 'object') {
    throw new Error('release manifest missing managedHarnesses')
  }
  const managedHarnesses: HarnessReleaseManifest['managedHarnesses'] = {}
  for (const id of ['claude', 'codex'] as const) {
    const entry = (mh as Record<string, unknown>)[id]
    if (entry == null) continue
    managedHarnesses[id] = parseManagedHarnessPin(id, entry)
  }
  return { cliVersion, managedHarnesses }
}

function parseManagedHarnessPin(id: string, raw: unknown): ManagedHarnessPin {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`manifest harness ${id} must be an object`)
  }
  const o = raw as Record<string, unknown>
  if (typeof o.runtimeVersion !== 'string' || typeof o.artifactVersion !== 'string') {
    throw new Error(`manifest harness ${id} missing runtimeVersion/artifactVersion`)
  }
  const runtimeVersion = assertSafePathSegment(o.runtimeVersion, `${id}.runtimeVersion`)
  const artifactVersion = assertSafePathSegment(o.artifactVersion, `${id}.artifactVersion`)
  if (!Array.isArray(o.artifacts) || o.artifacts.length === 0) {
    throw new Error(`manifest harness ${id} must list artifacts`)
  }
  const seen = new Set<string>()
  const artifacts: ManagedArtifactPin[] = o.artifacts.map((a, i) => {
    if (!a || typeof a !== 'object') throw new Error(`manifest ${id} artifacts[${i}] invalid`)
    const art = a as Record<string, unknown>
    const platform = art.platform
    const arch = art.arch
    const digest = art.digestSha256
    if (platform !== 'darwin' && platform !== 'linux' && platform !== 'windows') {
      throw new Error(`manifest ${id} artifacts[${i}] invalid platform`)
    }
    if (arch !== 'arm64' && arch !== 'x64') {
      throw new Error(`manifest ${id} artifacts[${i}] invalid arch`)
    }
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/i.test(digest)) {
      throw new Error(`manifest ${id} artifacts[${i}] digestSha256 must be 64 hex chars`)
    }
    const key = `${platform}/${arch}`
    if (seen.has(key)) {
      throw new Error(`manifest ${id} has duplicate artifact pin for ${key}`)
    }
    seen.add(key)
    let fileName: string | undefined
    if (typeof art.fileName === 'string') {
      // Display-only; still refuse path separators so it never becomes a path.
      if (art.fileName.includes('/') || art.fileName.includes('\\') || art.fileName.includes('\0')) {
        throw new Error(`manifest ${id} artifacts[${i}] fileName must not contain path separators`)
      }
      fileName = art.fileName.slice(0, 128)
    }
    let url: string | undefined
    if (typeof art.url === 'string' && art.url.trim()) {
      const u = art.url.trim()
      if (!/^https:\/\//i.test(u)) {
        throw new Error(`manifest ${id} artifacts[${i}] url must be https`)
      }
      if (u.length > 1024) {
        throw new Error(`manifest ${id} artifacts[${i}] url exceeds 1024 chars`)
      }
      url = u
    }
    let npmName: string | undefined
    if (typeof art.npmName === 'string' && art.npmName.trim()) {
      const n = art.npmName.trim()
      if (!/^(@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(n) || n.length > 214) {
        throw new Error(`manifest ${id} artifacts[${i}] npmName invalid`)
      }
      npmName = n
    }
    let npmVersion: string | undefined
    if (typeof art.npmVersion === 'string' && art.npmVersion.trim()) {
      // Versions may include platform suffixes (codex: 0.146.1-darwin-arm64).
      npmVersion = assertSafePathSegment(art.npmVersion, `${id}.artifacts[${i}].npmVersion`)
    }
    return {
      platform,
      arch,
      digestSha256: digest.toLowerCase(),
      fileName,
      url,
      npmName,
      npmVersion,
    }
  })
  return { runtimeVersion, artifactVersion, artifacts }
}

/**
 * Load the release manifest for this CLI.
 * Precedence:
 * 1. SUPERONE_HARNESS_MANIFEST path (tests / offline)
 * 2. $NODE_HOME/release-manifest.json
 * 3. none → null
 */
export function loadHarnessReleaseManifest(nodeHome: string): HarnessReleaseManifest | null {
  const fromEnv = process.env.SUPERONE_HARNESS_MANIFEST
  if (fromEnv) {
    if (!existsSync(fromEnv)) {
      throw new Error(`SUPERONE_HARNESS_MANIFEST not found: ${fromEnv}`)
    }
    return parseHarnessReleaseManifest(JSON.parse(readFileSync(fromEnv, 'utf8')))
  }
  const local = join(nodeHome, 'release-manifest.json')
  if (existsSync(local)) {
    return parseHarnessReleaseManifest(JSON.parse(readFileSync(local, 'utf8')))
  }
  return null
}

export function selectArtifactPin(
  pin: ManagedHarnessPin,
  platform = currentHostPlatform(),
  arch = currentHostArch(),
): ManagedArtifactPin {
  const match = pin.artifacts.find((a) => a.platform === platform && a.arch === arch)
  if (!match) {
    throw new Error(
      `no managed artifact pin for ${platform}/${arch} (available: ${pin.artifacts
        .map((a) => `${a.platform}/${a.arch}`)
        .join(', ')})`,
    )
  }
  return match
}

export async function sha256File(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

export function releasesRoot(nodeHome: string): string {
  return resolve(nodeHome, 'releases')
}

export function harnessVersionDir(
  nodeHome: string,
  cliVersion: string,
  harnessId: ManagedHarnessId,
  artifactVersion: string,
): string {
  const cli = assertSafePathSegment(cliVersion, 'cliVersion')
  const ver = assertSafePathSegment(artifactVersion, 'artifactVersion')
  const root = releasesRoot(nodeHome)
  const dest = resolve(root, cli, 'harnesses', harnessId, ver)
  assertPathInside(dest, resolve(root, cli, 'harnesses', harnessId), 'version install dir')
  return dest
}

/** Ensure `path` resolves strictly inside `root` (including equality). */
export function assertPathInside(path: string, root: string, label: string): void {
  const resolvedPath = resolve(path)
  const resolvedRoot = resolve(root)
  const rel = relative(resolvedRoot, resolvedPath)
  if (rel.startsWith('..') || rel === '..') {
    throw new Error(`${label} escapes install root: ${resolvedPath}`)
  }
  // On Windows, different drive letters produce absolute relative paths.
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
    throw new Error(`${label} escapes install root: ${resolvedPath}`)
  }
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + sep)) {
    throw new Error(`${label} escapes install root: ${resolvedPath}`)
  }
}

function assertStrictChild(path: string, parent: string, label: string): void {
  const resolvedPath = resolve(path)
  const resolvedParent = resolve(parent)
  if (resolvedPath === resolvedParent) {
    throw new Error(`${label} must be a child of ${resolvedParent}`)
  }
  assertPathInside(resolvedPath, resolvedParent, label)
}

/**
 * Verify offline artifact against the manifest pin and install.
 * Version directories are immutable; activation is an atomic pointer write.
 */
export async function installManagedArtifactFromFile(opts: {
  nodeHome: string
  harnessId: ManagedHarnessId
  artifactPath: string
  manifest: HarnessReleaseManifest
  /** When set, must equal manifest.cliVersion (release coupling). */
  expectedCliVersion?: string
  /**
   * `enable` (default): reuse intact installs; fail closed on corrupt existing dir.
   * `repair`: replace corrupt/missing payload via temp file + rename (atomic).
   */
  mode?: 'enable' | 'repair'
}): Promise<InstallManagedArtifactResult> {
  const mode = opts.mode ?? 'enable'
  const expected = opts.expectedCliVersion ?? currentCliVersion()
  if (opts.manifest.cliVersion !== expected) {
    throw new Error(
      `release manifest cliVersion ${opts.manifest.cliVersion} does not match CLI ${expected}`,
    )
  }

  const pin = opts.manifest.managedHarnesses[opts.harnessId]
  if (!pin) {
    throw new Error(`release manifest does not pin managed harness ${opts.harnessId}`)
  }
  const art = selectArtifactPin(pin)
  if (!existsSync(opts.artifactPath)) {
    throw new Error(`artifact not found: ${opts.artifactPath}`)
  }
  if (!statSync(opts.artifactPath).isFile()) {
    throw new Error(`artifact is not a regular file: ${opts.artifactPath}`)
  }

  const digest = await sha256File(opts.artifactPath)
  if (digest !== art.digestSha256) {
    throw new Error(
      `artifact digest mismatch for ${opts.harnessId}: expected ${art.digestSha256}, got ${digest}`,
    )
  }

  const destDir = harnessVersionDir(
    opts.nodeHome,
    opts.manifest.cliVersion,
    opts.harnessId,
    pin.artifactVersion,
  )
  const finalFile = join(destDir, MANAGED_PAYLOAD_BASENAME)
  const metaPath = join(destDir, MANAGED_META_BASENAME)
  assertStrictChild(finalFile, destDir, 'payload path')
  assertStrictChild(metaPath, destDir, 'meta path')

  const metaBody = JSON.stringify(
    {
      harnessId: opts.harnessId,
      cliVersion: opts.manifest.cliVersion,
      runtimeVersion: pin.runtimeVersion,
      artifactVersion: pin.artifactVersion,
      platform: art.platform,
      arch: art.arch,
      digestSha256: art.digestSha256,
      displayFileName: art.fileName ?? null,
      installedAt: Date.now(),
    },
    null,
    2,
  )

  let reusedExisting = false

  if (existsSync(destDir)) {
    const payloadOk =
      existsSync(finalFile) &&
      statSync(finalFile).isFile() &&
      (await sha256File(finalFile)) === art.digestSha256

    if (payloadOk) {
      reusedExisting = true
    } else if (mode === 'repair') {
      await replacePayloadAtomically({
        destDir,
        finalFile,
        metaPath,
        sourceArtifact: opts.artifactPath,
        expectedDigest: art.digestSha256,
        metaBody,
      })
      reusedExisting = false
    } else {
      throw new Error(
        `existing install digest mismatch for ${opts.harnessId}@${pin.artifactVersion}: ` +
          `refusing to overwrite (use harness repair)`,
      )
    }
  } else {
    // Create via unique staging dir under the same parent, then rename into place.
    const harnessRoot = dirname(destDir)
    mkdirSync(harnessRoot, { recursive: true })
    assertPathInside(destDir, harnessRoot, 'version dir')

    const stagingDir = mkdtempSync(
      join(harnessRoot, `.staging-${opts.harnessId}-${randomBytes(8).toString('hex')}-`),
    )
    assertPathInside(stagingDir, harnessRoot, 'staging dir')
    const stagingFile = join(stagingDir, MANAGED_PAYLOAD_BASENAME)
    const stagingMeta = join(stagingDir, MANAGED_META_BASENAME)
    try {
      copyFileSync(opts.artifactPath, stagingFile)
      const stagedDigest = await sha256File(stagingFile)
      if (stagedDigest !== art.digestSha256) {
        throw new Error(`staged artifact digest mismatch for ${opts.harnessId}`)
      }
      writeFileSync(stagingMeta, metaBody, 'utf8')
      // Atomic create of the immutable version directory.
      renameSync(stagingDir, destDir)
    } catch (err) {
      rmSync(stagingDir, { recursive: true, force: true })
      // Race: another process created destDir — try immutable reuse or repair.
      if (existsSync(destDir) && existsSync(finalFile)) {
        const existingDigest = await sha256File(finalFile)
        if (existingDigest === art.digestSha256) {
          reusedExisting = true
        } else if (mode === 'repair') {
          await replacePayloadAtomically({
            destDir,
            finalFile,
            metaPath,
            sourceArtifact: opts.artifactPath,
            expectedDigest: art.digestSha256,
            metaBody,
          })
        } else {
          throw err
        }
      } else {
        throw err
      }
    }
  }

  // Final defense: payload digest must still match before activation.
  const finalDigest = await sha256File(finalFile)
  if (finalDigest !== art.digestSha256) {
    throw new Error(`final payload digest mismatch for ${opts.harnessId}`)
  }

  // Atomic activation pointer (unique temp name, then rename).
  const harnessRoot = join(
    releasesRoot(opts.nodeHome),
    opts.manifest.cliVersion,
    'harnesses',
    opts.harnessId,
  )
  assertPathInside(harnessRoot, releasesRoot(opts.nodeHome), 'harness root')
  mkdirSync(harnessRoot, { recursive: true })
  const currentPath = join(harnessRoot, MANAGED_CURRENT_BASENAME)
  const currentTmp = join(
    harnessRoot,
    `.${MANAGED_CURRENT_BASENAME}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  )
  assertStrictChild(currentTmp, harnessRoot, 'current pointer temp')
  try {
    writeFileSync(
      currentTmp,
      JSON.stringify(
        {
          artifactVersion: pin.artifactVersion,
          installPath: finalFile,
          digestSha256: art.digestSha256,
          runtimeVersion: pin.runtimeVersion,
        },
        null,
        2,
      ),
      'utf8',
    )
    renameSync(currentTmp, currentPath)
  } catch (err) {
    rmSync(currentTmp, { force: true })
    throw err
  }

  return {
    harnessId: opts.harnessId,
    cliVersion: opts.manifest.cliVersion,
    runtimeVersion: pin.runtimeVersion,
    artifactVersion: pin.artifactVersion,
    digestSha256: art.digestSha256,
    installPath: finalFile,
    source: 'offline-artifact',
    reusedExisting,
  }
}

/**
 * Repair corrupt payload: write verified temp files then rename over the
 * live payload/meta. Does not delete the version directory itself.
 */
async function replacePayloadAtomically(opts: {
  destDir: string
  finalFile: string
  metaPath: string
  sourceArtifact: string
  expectedDigest: string
  metaBody: string
}): Promise<void> {
  mkdirSync(opts.destDir, { recursive: true })
  const nonce = randomBytes(8).toString('hex')
  const payloadTmp = join(opts.destDir, `.${MANAGED_PAYLOAD_BASENAME}.${nonce}.tmp`)
  const metaTmp = join(opts.destDir, `.${MANAGED_META_BASENAME}.${nonce}.tmp`)
  assertStrictChild(payloadTmp, opts.destDir, 'payload temp')
  assertStrictChild(metaTmp, opts.destDir, 'meta temp')
  try {
    copyFileSync(opts.sourceArtifact, payloadTmp)
    const d = await sha256File(payloadTmp)
    if (d !== opts.expectedDigest) {
      throw new Error(`repair staged digest mismatch: expected ${opts.expectedDigest}, got ${d}`)
    }
    writeFileSync(metaTmp, opts.metaBody, 'utf8')
    // Rename over live files (atomic on same filesystem).
    renameSync(payloadTmp, opts.finalFile)
    renameSync(metaTmp, opts.metaPath)
  } catch (err) {
    rmSync(payloadTmp, { force: true })
    rmSync(metaTmp, { force: true })
    throw err
  }
}

/** Human-readable expected pin for error messages when --artifact is missing. */
export function describeExpectedArtifact(
  harnessId: ManagedHarnessId,
  manifest: HarnessReleaseManifest,
): string {
  const pin = manifest.managedHarnesses[harnessId]
  if (!pin) return `harness ${harnessId} is not pinned in the release manifest`
  try {
    const art = selectArtifactPin(pin)
    return (
      `${harnessId} requires offline --artifact matching ` +
      `${art.platform}/${art.arch} digest ${art.digestSha256} ` +
      `(runtime ${pin.runtimeVersion}, artifact ${pin.artifactVersion}); ` +
      `network download is not enabled in Stage 3`
    )
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

export function readInstalledCurrent(
  nodeHome: string,
  cliVersion: string,
  harnessId: ManagedHarnessId,
): { artifactVersion: string; installPath: string } | null {
  const cli = assertSafePathSegment(cliVersion, 'cliVersion')
  const currentLink = join(releasesRoot(nodeHome), cli, 'harnesses', harnessId, MANAGED_CURRENT_BASENAME)
  if (!existsSync(currentLink)) return null
  try {
    const parsed = JSON.parse(readFileSync(currentLink, 'utf8')) as {
      artifactVersion?: string
      installPath?: string
    }
    if (typeof parsed.artifactVersion === 'string' && typeof parsed.installPath === 'string') {
      return { artifactVersion: parsed.artifactVersion, installPath: parsed.installPath }
    }
  } catch {
    return null
  }
  return null
}

/** Used by doctor: required runtime version from manifest if present. */
export function requiredRuntimeVersion(
  harnessId: NodeHarnessId,
  manifest: HarnessReleaseManifest | null,
): string | null {
  if (harnessId !== 'claude' && harnessId !== 'codex') return null
  return manifest?.managedHarnesses[harnessId]?.runtimeVersion ?? null
}
