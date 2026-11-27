import {
  EXTERNAL_CLI_HARNESS_IDS,
  checkExternalCliVersion,
  getExternalCliMinVersion,
  isExternalCliUpdateAvailable,
  normalizeExternalCliVersion,
  type ExternalCliHarnessId,
  type ExternalCliUpdateCheckOptions,
  type ExternalCliUpdateInfo,
  type HarnessInstallationStatus,
} from '@superone/shared/environment'
import { desktopNetFetch } from '../desktop-net-fetch'
import { listHarnessInstallations } from './service'

const ANTIGRAVITY_MANIFEST_BASE =
  'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests'
const NPM_REGISTRY_BASE = 'https://registry.npmjs.org'
const FETCH_TIMEOUT_MS = 5_000
const FOUND_TTL_MS = 60 * 60 * 1_000
const MISSING_TTL_MS = 60 * 1_000

interface CachedLatestEntry {
  version: string | null
  expiresAt: number
}

export interface ExternalCliUpdateDeps {
  fetchImpl?: typeof fetch
  platform?: NodeJS.Platform
  arch?: string
  now?: () => number
  listInstallations?: () => HarnessInstallationStatus[]
}

const latestCache = new Map<ExternalCliHarnessId, CachedLatestEntry>()
const inflightLookups = new Map<ExternalCliHarnessId, Promise<string | null>>()

export function clearExternalCliLatestVersionCache(harnessId?: ExternalCliHarnessId): void {
  if (harnessId) {
    latestCache.delete(harnessId)
    return
  }
  latestCache.clear()
}

export function resolveExternalCliLatestVersionUrl(
  harnessId: ExternalCliHarnessId,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  if (harnessId === 'acp-antigravity') {
    if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') return null
    if (arch !== 'x64' && arch !== 'arm64') return null
    const os = platform === 'win32' ? 'windows' : platform
    const cpu = arch === 'x64' ? 'amd64' : 'arm64'
    return `${ANTIGRAVITY_MANIFEST_BASE}/${os}_${cpu}.json`
  }
  if (harnessId === 'acp-grok') {
    return `${NPM_REGISTRY_BASE}/${encodeURIComponent('@xai-official/grok')}/latest`
  }
  return `${NPM_REGISTRY_BASE}/${encodeURIComponent('@opencode/cli')}/latest`
}

async function fetchLatestVersionRaw(
  harnessId: ExternalCliHarnessId,
  deps: ExternalCliUpdateDeps,
): Promise<string | null> {
  const url = resolveExternalCliLatestVersionUrl(
    harnessId,
    deps.platform ?? process.platform,
    deps.arch ?? process.arch,
  )
  if (!url) return null
  const fetchFn = deps.fetchImpl ?? desktopNetFetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetchFn(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) return null
    const payload = (await res.json()) as { version?: unknown } | null
    return normalizeExternalCliVersion(
      typeof payload?.version === 'string' ? payload.version : undefined,
    ) ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchLatestExternalCliVersion(
  harnessId: ExternalCliHarnessId,
  opts?: { force?: boolean },
  deps: ExternalCliUpdateDeps = {},
): Promise<string | null> {
  const now = (deps.now ?? Date.now)()
  if (!opts?.force) {
    const cached = latestCache.get(harnessId)
    if (cached && cached.expiresAt > now) {
      return cached.version
    }
    const pending = inflightLookups.get(harnessId)
    if (pending) return pending
  }

  const run = fetchLatestVersionRaw(harnessId, deps)
    .then((version) => {
      const finishedAt = (deps.now ?? Date.now)()
      latestCache.set(harnessId, {
        version,
        expiresAt: finishedAt + (version ? FOUND_TTL_MS : MISSING_TTL_MS),
      })
      return version
    })
    .finally(() => {
      if (inflightLookups.get(harnessId) === run) {
        inflightLookups.delete(harnessId)
      }
    })

  inflightLookups.set(harnessId, run)
  return run
}

export async function checkExternalCliUpdates(
  opts: ExternalCliUpdateCheckOptions = {},
  deps: ExternalCliUpdateDeps = {},
): Promise<Partial<Record<ExternalCliHarnessId, ExternalCliUpdateInfo>>> {
  const targets =
    opts.harnessIds && opts.harnessIds.length > 0
      ? opts.harnessIds
      : [...EXTERNAL_CLI_HARNESS_IDS]
  const installations = (deps.listInstallations ?? listHarnessInstallations)()
  const byId = new Map(installations.map((row) => [row.id, row]))
  const now = (deps.now ?? Date.now)()

  const entries = await Promise.all(
    targets.map(async (harnessId): Promise<[ExternalCliHarnessId, ExternalCliUpdateInfo]> => {
      const row = byId.get(harnessId)
      const currentVersion = row?.runtimeVersion
      const latestVersion = await fetchLatestExternalCliVersion(
        harnessId,
        { force: opts.force },
        deps,
      )
      const minCheck = checkExternalCliVersion(harnessId, currentVersion)
      return [
        harnessId,
        {
          harnessId,
          ...(currentVersion ? { currentVersion } : {}),
          latestVersion,
          updateAvailable: isExternalCliUpdateAvailable(currentVersion, latestVersion),
          belowMinimum: !minCheck.ok,
          minVersion: getExternalCliMinVersion(harnessId),
          checkedAt: now,
        },
      ]
    }),
  )

  return Object.fromEntries(entries) as Partial<
    Record<ExternalCliHarnessId, ExternalCliUpdateInfo>
  >
}
