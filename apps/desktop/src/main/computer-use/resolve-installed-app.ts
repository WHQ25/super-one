import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type ResolvedInstalledApp = {
  /** Prefer localized / CFBundleDisplayName when known. */
  app: string
  bundleId: string
  path: string
  /** All known display names (en + localized) for matching. */
  aliases: string[]
}

type CacheEntry = {
  at: number
  apps: ResolvedInstalledApp[]
}

const SCAN_TTL_MS = 60_000
/** Cap concurrent Info.plist / plutil work so cold scan does not flood the event loop. */
const READ_CONCURRENCY = 12

let cache: CacheEntry | null = null
/** Coalesce concurrent cold scans (e.g. @-mention + computer_apps). */
let inFlightScan: Promise<ResolvedInstalledApp[]> | null = null

/** Test injection — bypasses LaunchServices / disk scan. */
let testOverride:
  | ((query: string) => Promise<ResolvedInstalledApp | null> | ResolvedInstalledApp | null)
  | null = null

export function setResolveInstalledAppForTests(
  fn: typeof testOverride,
): void {
  testOverride = fn
}

/** Test helper. */
export function clearInstalledAppCacheForTests(): void {
  cache = null
  inFlightScan = null
  testOverride = null
}

/**
 * Resolve a user/agent query (display name in any locale, or reverse-DNS
 * bundle id) to a concrete installed app identity — even when the app is not
 * running. Never returns a "fake" bundleId equal to the raw display name.
 */
export async function resolveInstalledApp(
  query: string,
): Promise<ResolvedInstalledApp | null> {
  const q = query.trim()
  if (!q) return null
  if (testOverride) return testOverride(q)

  // Reverse-DNS bundle ids: LaunchServices first, then scan index.
  if (looksLikeBundleId(q)) {
    const byId = await resolveByBundleId(q)
    if (byId) return byId
  }

  // Filesystem-only scan with localized CFBundleDisplayName. AppleScript
  // application references are intentionally avoided because resolving an
  // application's id can launch it as a side effect.
  const apps = await listInstalledApps()
  const lower = q.toLowerCase()
  const exact =
    apps.find((a) => a.bundleId.toLowerCase() === lower)
    ?? apps.find((a) => a.aliases.some((n) => n.toLowerCase() === lower))
  if (exact) return exact

  const partial = apps.find((a) =>
    a.aliases.some((n) => {
      const nl = n.toLowerCase()
      return nl.includes(lower) || lower.includes(nl)
    }),
  )
  return partial ?? null
}

function looksLikeBundleId(q: string): boolean {
  return q.includes('.') && !q.includes(' ') && !q.includes('/')
}

async function resolveByBundleId(bundleId: string): Promise<ResolvedInstalledApp | null> {
  try {
    const { stdout } = await execFileAsync(
      'mdfind',
      [`kMDItemCFBundleIdentifier == "${bundleId}"`],
      { timeout: 2000 },
    )
    const path =
      stdout
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.endsWith('.app')) ?? null
    if (path && existsSync(path)) {
      return (await readAppAtPath(path)) ?? synthetic(path, bundleId)
    }
  } catch {
    // fall through
  }

  return null
}

function synthetic(path: string, bundleId: string): ResolvedInstalledApp {
  const name = basename(path, '.app')
  return { app: name, bundleId, path, aliases: [name, bundleId] }
}

/**
 * Public catalog of installed .app bundles (cached ~60s).
 * Async so cold scan never blocks the Electron main thread with sync I/O / plutil.
 */
export async function listInstalledApps(): Promise<ResolvedInstalledApp[]> {
  if (cache && Date.now() - cache.at < SCAN_TTL_MS) return cache.apps
  if (inFlightScan) return inFlightScan

  inFlightScan = scanInstalledApps()
    .then((apps) => {
      cache = { at: Date.now(), apps }
      return apps
    })
    .finally(() => {
      inFlightScan = null
    })

  return inFlightScan
}

async function scanInstalledApps(): Promise<ResolvedInstalledApp[]> {
  const dirs = [
    '/Applications',
    '/System/Applications',
    join(homedir(), 'Applications'),
  ]

  const appPaths: string[] = []
  for (const dir of dirs) {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith('.app')) continue
      appPaths.push(join(dir, entry))
    }
  }

  const identities = await mapPool(appPaths, READ_CONCURRENCY, (path) => readAppAtPath(path))
  const apps: ResolvedInstalledApp[] = []
  const seen = new Set<string>()
  for (const identity of identities) {
    if (!identity) continue
    if (seen.has(identity.bundleId)) continue
    seen.add(identity.bundleId)
    apps.push(identity)
  }
  return apps
}

/** Run async work over items with a fixed concurrency cap. */
async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++
        if (i >= items.length) return
        results[i] = await fn(items[i])
      }
    },
  )
  await Promise.all(workers)
  return results
}

/**
 * Read bundle id + display names without spawning `defaults` per key.
 * Parses XML plists lightly; binary plists fall back to plutil once.
 */
async function readAppAtPath(appPath: string): Promise<ResolvedInstalledApp | null> {
  if (!appPath.endsWith('.app')) return null
  const infoPath = join(appPath, 'Contents', 'Info.plist')

  const info = await readPlistDict(infoPath)
  const bundleId = typeof info.CFBundleIdentifier === 'string' ? info.CFBundleIdentifier : null
  if (!bundleId) return null

  const aliases = new Set<string>()
  const fsName = basename(appPath, '.app')
  aliases.add(fsName)
  for (const key of ['CFBundleDisplayName', 'CFBundleName'] as const) {
    const v = info[key]
    if (typeof v === 'string' && v.trim()) aliases.add(v.trim())
  }

  // Localized display names (e.g. zh_CN "豆包" for Doubao.app).
  const resources = join(appPath, 'Contents', 'Resources')
  let lprojs: string[] = []
  try {
    lprojs = (await readdir(resources)).filter((e) => e.endsWith('.lproj'))
  } catch {
    lprojs = []
  }
  if (lprojs.length > 0) {
    const preferred = [
      'zh_CN.lproj',
      'zh-Hans.lproj',
      'zh_TW.lproj',
      'zh-Hant.lproj',
      'en.lproj',
      'Base.lproj',
    ]
    const ordered = [
      ...preferred.filter((p) => lprojs.includes(p)),
      // Cap remaining locales so a huge lproj set can't stall cold resolve.
      ...lprojs.filter((p) => !preferred.includes(p)).slice(0, 4),
    ]
    for (const lproj of ordered) {
      const strings = join(resources, lproj, 'InfoPlist.strings')
      const dict = await readPlistDict(strings)
      for (const key of ['CFBundleDisplayName', 'CFBundleName'] as const) {
        const v = dict[key]
        if (typeof v === 'string' && v.trim()) aliases.add(v.trim())
      }
    }
  }

  const display =
    [...aliases].find((a) => a !== fsName && a !== bundleId) ?? fsName

  return {
    app: display,
    bundleId,
    path: appPath,
    aliases: [...aliases, bundleId],
  }
}

async function readPlistDict(filePath: string): Promise<Record<string, unknown>> {
  // Fast path: XML plist text parse for common keys (no process spawn).
  try {
    const raw = await readFile(filePath, 'utf8')
    if (raw.includes('<?xml') || raw.includes('<plist')) {
      return parseXmlPlistStrings(raw)
    }
  } catch {
    // missing / binary / unreadable — fall through
  }

  try {
    // plutil once per file for binary plists / binary strings (async — does not block main).
    const { stdout: raw } = await execFileAsync(
      'plutil',
      ['-convert', 'json', '-o', '-', filePath],
      { encoding: 'utf8', timeout: 800 },
    )
    const obj = JSON.parse(raw) as unknown
    return obj && typeof obj === 'object' && !Array.isArray(obj)
      ? (obj as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** Minimal XML plist string-value extractor (enough for Info.plist name keys). */
function parseXmlPlistStrings(xml: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const re =
    /<key>(CFBundleIdentifier|CFBundleDisplayName|CFBundleName)<\/key>\s*<string>([^<]*)<\/string>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    out[m[1]] = decodeXml(m[2])
  }
  return out
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}
