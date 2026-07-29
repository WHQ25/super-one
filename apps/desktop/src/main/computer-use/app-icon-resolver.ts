import { execFile, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  existsSync,
  readdirSync,
  readFileSync,
  mkdtempSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { NativeImage } from 'electron'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)

/**
 * electron is CJS; ESM `import('electron')` often yields `{ default: … }` or a
 * path string under vitest. Prefer createRequire so app.getFileIcon works in
 * the real main process.
 */
function loadElectron(): {
  app?: { getFileIcon: (path: string, options?: { size: string }) => Promise<NativeImage> }
  nativeImage?: {
    createFromPath: (path: string) => NativeImage
  }
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('electron') as ReturnType<typeof loadElectron>
  } catch {
    return null
  }
}

/** Avoid top-level electron-log import so unit tests can load this module. */
function iconLog(level: 'info' | 'warn', message: string, ...args: unknown[]): void {
  const line = `[computer-use] ${message}`
  if (level === 'warn') console.warn(line, ...args)
  else console.info(line, ...args)
  void import('../logger')
    .then(({ default: log }) => {
      if (level === 'warn') log.warn(line, ...args)
      else log.info(line, ...args)
    })
    .catch(() => {
      // tests / early boot without electron-log
    })
}

type CacheEntry = { uri: string | null; at: number }

const iconCache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<string | null>>()

const LOOKUP_TIMEOUT_MS = 4000
/** Successful lookups stay for process lifetime; misses retry after this window. */
const NEGATIVE_CACHE_MS = 15_000
/**
 * Bump when icon extraction strategy changes so a process that already cached
 * blank getFileIcon results does not keep serving them after hot reload.
 */
// Bump when extraction strategy changes so negative/blank caches drop on reload.
const ICON_CACHE_EPOCH = 4
/**
 * Real 64×64 PNG data URIs are typically ≥3KB. Electron's generic/blank file
 * icons and failed multi-res .icns loads often land around 1.5–2KB.
 */
const MIN_USEFUL_DATA_URI_CHARS = 2500

/** True only for regular files — rejects dirs that collide on case-insensitive APFS. */
function isRegularFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Best-effort macOS app icon lookup for a bundle id, as a data: URI PNG.
 * Cached per bundleId; negative lookups expire so a transient Spotlight/timeout
 * miss does not permanently blank HITL icons for the rest of the session.
 */
/** Reverse-DNS style ids only — blocks AppleScript / mdfind injection. */
export function isSafeBundleId(bundleId: string): boolean {
  // e.g. com.apple.TextEdit, com.bot.pc.doubao — no spaces, quotes, or shell metacharacters.
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,253}$/.test(bundleId)
}

export async function resolveAppIconDataUri(bundleId: string): Promise<string | null> {
  if (!bundleId || !isSafeBundleId(bundleId)) {
    if (bundleId) iconLog('warn', 'app-icon rejected unsafe bundleId %s', bundleId)
    return null
  }

  const cacheKey = `${ICON_CACHE_EPOCH}:${bundleId}`
  const cached = iconCache.get(cacheKey)
  if (cached !== undefined) {
    if (cached.uri != null) return cached.uri
    if (Date.now() - cached.at < NEGATIVE_CACHE_MS) return null
    iconCache.delete(cacheKey)
  }

  let promise = inflight.get(cacheKey)
  if (!promise) {
    promise = lookupIcon(bundleId)
      .catch((err) => {
        iconLog(
          'warn',
          'app-icon lookup threw for %s: %s',
          bundleId,
          err instanceof Error ? err.message : String(err),
        )
        return null
      })
      .then((result) => {
        iconCache.set(cacheKey, { uri: result, at: Date.now() })
        iconLog(
          'info',
          'app-icon resolve %s → %s',
          bundleId,
          result ? `ok (dataUri ${result.length} chars)` : 'null',
        )
        return result
      })
      .finally(() => {
        inflight.delete(cacheKey)
      })
    inflight.set(cacheKey, promise)
  }
  return promise
}

/** Test helper — wipe process caches. */
export function clearAppIconCacheForTests(): void {
  iconCache.clear()
  inflight.clear()
}

/** Not a type predicate — short data URIs are still strings. */
function isUsefulDataUri(uri: string | null | undefined): boolean {
  return !!uri && uri.startsWith('data:image/') && uri.length >= MIN_USEFUL_DATA_URI_CHARS
}

async function lookupIcon(bundleId: string): Promise<string | null> {
  const t0 = Date.now()
  const appPath =
    (await resolveAppPath(bundleId)) ?? (await resolveAppPathViaOsascript(bundleId))
  if (!appPath) {
    iconLog(
      'warn',
      'app-icon path miss for %s after %dms (mdfind + osascript)',
      bundleId,
      Date.now() - t0,
    )
    return null
  }
  iconLog(
    'info',
    'app-icon path for %s → %s (%dms)',
    bundleId,
    appPath,
    Date.now() - t0,
  )

  // 1) Real bundle icon via sips (most reliable for multi-res .icns).
  const fromIcns = await iconViaIcns(appPath)
  if (fromIcns && isUsefulDataUri(fromIcns)) {
    iconLog(
      'info',
      'app-icon icns ok for %s (%d chars, %dms)',
      bundleId,
      fromIcns.length,
      Date.now() - t0,
    )
    return fromIcns
  }

  // 2) Electron getFileIcon — often returns a generic light glyph; reject tiny ones.
  const fromElectron = await iconViaGetFileIcon(appPath)
  if (fromElectron && isUsefulDataUri(fromElectron)) {
    iconLog(
      'info',
      'app-icon getFileIcon ok for %s (%d chars, %dms)',
      bundleId,
      fromElectron.length,
      Date.now() - t0,
    )
    return fromElectron
  }
  if (fromElectron) {
    iconLog(
      'warn',
      'app-icon getFileIcon too small for %s (%d chars) — discarded',
      bundleId,
      fromElectron.length,
    )
  }

  iconLog(
    'warn',
    'app-icon all strategies failed for %s path=%s (%dms)',
    bundleId,
    appPath,
    Date.now() - t0,
  )
  return null
}

async function iconViaGetFileIcon(appPath: string): Promise<string | null> {
  try {
    const electron = loadElectron()
    const app = electron?.app
    if (!app?.getFileIcon) {
      iconLog('warn', 'app-icon getFileIcon unavailable (electron.app missing)')
      return null
    }
    // Must call on the App instance — unbound method throws Illegal invocation.
    const icon = await app.getFileIcon(appPath, { size: 'normal' })
    if (icon.isEmpty()) {
      iconLog('warn', 'app-icon getFileIcon empty for %s', appPath)
      return null
    }
    const uri = icon.toDataURL()
    if (!uri || !uri.startsWith('data:image/')) {
      iconLog(
        'warn',
        'app-icon getFileIcon bad data URL for %s prefix=%s',
        appPath,
        uri?.slice(0, 32) ?? 'null',
      )
      return null
    }
    return uri
  } catch (err) {
    iconLog(
      'warn',
      'app-icon getFileIcon error for %s: %s',
      appPath,
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
}

/**
 * Locate the app's real .icns and convert to PNG.
 * Prefer sips — nativeImage.createFromPath often fails on multi-representation .icns.
 */
async function iconViaIcns(appPath: string): Promise<string | null> {
  const icnsPath = findIcnsPath(appPath)
  if (!icnsPath) {
    iconLog('warn', 'app-icon no .icns under %s', appPath)
    return null
  }
  iconLog('info', 'app-icon trying icns %s', icnsPath)

  const fromSips = await iconViaSips(icnsPath)
  if (isUsefulDataUri(fromSips)) return fromSips

  try {
    const createFromPath = loadElectron()?.nativeImage?.createFromPath
    if (createFromPath) {
      const img = createFromPath(icnsPath)
      if (!img.isEmpty()) {
        // Omit `quality` — Electron typings for resize quality vary by version.
        const resized = img.resize({ width: 64, height: 64 })
        const uri = (resized.isEmpty() ? img : resized).toDataURL()
        if (isUsefulDataUri(uri)) return uri
        iconLog(
          'warn',
          'app-icon nativeImage too small for %s (%d chars)',
          icnsPath,
          uri.length,
        )
      } else {
        iconLog('warn', 'app-icon nativeImage empty for %s', icnsPath)
      }
    }
  } catch (err) {
    iconLog(
      'warn',
      'app-icon nativeImage error for %s: %s',
      icnsPath,
      err instanceof Error ? err.message : String(err),
    )
  }

  return fromSips // may be small/null
}

function readPlistIconName(appPath: string): string | null {
  const infoPath = join(appPath, 'Contents', 'Info.plist')
  if (!existsSync(infoPath)) return null
  for (const key of ['CFBundleIconFile', 'CFBundleIconName'] as const) {
    try {
      const raw = execFileSync(
        'defaults',
        ['read', join(appPath, 'Contents', 'Info'), key],
        { encoding: 'utf8', timeout: 800 },
      ).trim()
      if (raw) return raw
    } catch {
      // try next
    }
  }
  // plutil JSON fallback (binary plists)
  try {
    const raw = execFileSync('plutil', ['-convert', 'json', '-o', '-', infoPath], {
      encoding: 'utf8',
      timeout: 800,
    })
    const obj = JSON.parse(raw) as Record<string, unknown>
    for (const key of ['CFBundleIconFile', 'CFBundleIconName'] as const) {
      const v = obj[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  } catch {
    // ignore
  }
  return null
}

/**
 * Locate the app icon .icns under Contents/Resources.
 *
 * Important on default macOS APFS (case-insensitive): CFBundleIconFile often
 * omits the extension (e.g. "Ghostty"). A bare path
 * `Resources/Ghostty` can resolve to a *directory* named `ghostty/` and steal
 * the match from `Ghostty.icns`. Always prefer the .icns file and require a
 * regular file (not a directory).
 */
function findIcnsPath(appPath: string): string | null {
  const resources = join(appPath, 'Contents', 'Resources')
  if (!existsSync(resources)) return null

  const iconName = readPlistIconName(appPath)
  if (iconName) {
    const base = iconName.replace(/\.icns$/i, '')
    // Prefer explicit .icns before bare name so dirs never win over Ghostty.icns.
    const candidates = [
      join(resources, `${base}.icns`),
      join(resources, iconName.endsWith('.icns') ? iconName : `${iconName}.icns`),
      join(resources, iconName),
    ]
    for (const c of candidates) {
      if (isRegularFile(c)) return c
    }
  }

  try {
    const entries = readdirSync(resources).filter((e) => e.toLowerCase().endsWith('.icns'))
    if (entries.length === 0) return null

    // Prefer real app icons; avoid document-type glyphs like icon_file-csv-*.icns
    // which match a naive /icon/i filter and look blank/wrong in the UI.
    const score = (name: string): number => {
      const n = name.toLowerCase()
      if (n === 'app.icns' || n === 'appicon.icns') return 100
      if (n.startsWith('appicon')) return 90
      if (n === 'icon.icns') return 80
      if (n.includes('appicon') || n.includes('application')) return 70
      if (n.includes('file') || n.includes('doc') || n.includes('document')) return 0
      if (n.startsWith('icon_')) return 10
      if (n.includes('icon')) return 40
      return 20
    }
    entries.sort((a, b) => score(b) - score(a) || a.localeCompare(b))
    const best = entries[0]
    if (score(best) <= 0 && entries.length > 1) {
      // All look like document icons — still try the first non-file name if any.
      const nonDoc = entries.find((e) => score(e) > 0)
      const pick = nonDoc ?? best
      const path = join(resources, pick)
      return isRegularFile(path) ? path : null
    }
    const path = join(resources, best)
    return isRegularFile(path) ? path : null
  } catch {
    return null
  }
}

/** @internal test helper — path only, no conversion. */
export function findAppIcnsPathForTests(appPath: string): string | null {
  return findIcnsPath(appPath)
}

async function iconViaSips(icnsPath: string): Promise<string | null> {
  if (!isRegularFile(icnsPath)) {
    iconLog('warn', 'app-icon sips skip non-file %s', icnsPath)
    return null
  }
  let dir: string | null = null
  try {
    dir = mkdtempSync(join(tmpdir(), 'superone-app-icon-'))
    const outPng = join(dir, 'icon.png')
    await execFileAsync(
      'sips',
      ['-z', '64', '64', '-s', 'format', 'png', icnsPath, '--out', outPng],
      { timeout: LOOKUP_TIMEOUT_MS },
    )
    if (!existsSync(outPng)) {
      iconLog('warn', 'app-icon sips produced no file for %s', icnsPath)
      return null
    }
    const buf = readFileSync(outPng)
    if (buf.byteLength === 0) return null
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch (err) {
    iconLog(
      'warn',
      'app-icon sips error for %s: %s',
      icnsPath,
      err instanceof Error ? err.message : String(err),
    )
    return null
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore cleanup
      }
    }
  }
}

async function resolveAppPath(bundleId: string): Promise<string | null> {
  if (!isSafeBundleId(bundleId)) return null
  try {
    // bundleId already validated; keep query quoted for Spotlight.
    const { stdout } = await execFileAsync(
      'mdfind',
      [`kMDItemCFBundleIdentifier == "${bundleId}"`],
      { timeout: LOOKUP_TIMEOUT_MS },
    )
    const path =
      stdout
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.endsWith('.app')) ?? null
    if (!path) {
      iconLog('info', 'app-icon mdfind empty for %s', bundleId)
    }
    return path
  } catch (err) {
    iconLog(
      'warn',
      'app-icon mdfind error for %s: %s',
      bundleId,
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
}

/** Spotlight can be unavailable; LaunchServices via osascript is a solid fallback. */
async function resolveAppPathViaOsascript(bundleId: string): Promise<string | null> {
  if (!isSafeBundleId(bundleId)) return null
  try {
    // Pass bundleId as argv — never interpolate into the script source.
    const { stdout } = await execFileAsync(
      'osascript',
      [
        '-e',
        'on run argv\nPOSIX path of (path to application id (item 1 of argv))\nend run',
        bundleId,
      ],
      { timeout: LOOKUP_TIMEOUT_MS },
    )
    const path = stdout.trim().replace(/\/$/, '')
    if (!path) return null
    return path.endsWith('.app') ? path : path
  } catch (err) {
    iconLog(
      'warn',
      'app-icon osascript error for %s: %s',
      bundleId,
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
}

