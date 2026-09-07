import { availableMentionCapabilityIds } from '@superone/shared/mention-capabilities'
import { statSync } from 'node:fs'
import { nativeImage } from 'electron'
import { readAppSettings } from '../app-settings-service'
import { resolveAppIconDataUri } from '../computer-use/app-icon-resolver'
import { listInstalledApps } from '../computer-use/resolve-installed-app'
import { discoverApps, discoverProjectApps, validatePath } from '../miniapp/miniapp-service'
import { discoverAllAgents } from './discover-resources'
import { searchMentions } from './fuzzy-file-search'
import { registerMentionIcon } from './remote-mention-icons'

const APP_RESULT_LIMIT = 12
const MAX_ICON_DATA_URI_LENGTH = 256_000

type SearchableApp = { id: string; name: string; aliases?: string[] }

export function matchesRemoteMentionApp(app: SearchableApp, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return !needle || [app.id, app.name, ...(app.aliases ?? [])].some((value) => value.toLowerCase().includes(needle))
}

/**
 * How an icon rides in the response: as bytes, or as an id the client can
 * exchange for bytes it does not already have.
 */
function icon(dataUri: string | undefined, byId: boolean): { iconDataUri?: string; iconId?: string } {
  if (!dataUri) return {}
  return byId ? { iconId: registerMentionIcon(dataUri) } : { iconDataUri: dataUri }
}

function boundedPngDataUri(value: string | null | undefined): string | undefined {
  return value?.startsWith('data:image/png;base64,') && value.length <= MAX_ICON_DATA_URI_LENGTH ? value : undefined
}

/**
 * Decoded mini-app logos, keyed by file and mtime.
 *
 * Without this every keystroke re-read, re-decoded and re-encoded every
 * installed mini-app's logo. The desktop app icons upstream have had a cache
 * for a while; these did not, and the search runs on the same hot path.
 */
const miniAppIcons = new Map<string, string | undefined>()

function miniAppIconDataUri(entry: Awaited<ReturnType<typeof discoverApps>>[number]): string | undefined {
  const logo = entry.manifest.logo
  if (!logo) return
  const path = validatePath(entry.distDir ?? entry.installDir, logo)
  if (!path) return
  let cacheKey = path
  try {
    cacheKey = `${path}:${statSync(path).mtimeMs}`
  } catch {
    // An unreadable logo falls through to the decode below, which reports it.
  }
  if (miniAppIcons.has(cacheKey)) return miniAppIcons.get(cacheKey)
  const decoded = decodeMiniAppIcon(path)
  // Bounded by how many mini-apps are installed, and keyed by mtime so a
  // rebuilt logo replaces its entry rather than shadowing it.
  if (miniAppIcons.size > 64) miniAppIcons.clear()
  miniAppIcons.set(cacheKey, decoded)
  return decoded
}

function decodeMiniAppIcon(path: string): string | undefined {
  try {
    const source = nativeImage.createFromPath(path)
    if (source.isEmpty()) return
    const size = source.getSize()
    const image = Math.max(size.width, size.height) > 128
      ? source.resize(size.width >= size.height ? { width: 128, quality: 'best' } : { height: 128, quality: 'best' }) : source
    return boundedPngDataUri(image.toDataURL())
  } catch { return }
}

async function listRemoteMentionApps(
  projectPath: string,
  query: string,
  includeDesktopApps: boolean,
  iconsById: boolean,
) {
  const settled = await Promise.allSettled([
    discoverApps(),
    discoverProjectApps(projectPath),
    includeDesktopApps ? listInstalledApps() : Promise.resolve([]),
  ])
  const userApps = settled[0].status === 'fulfilled' ? settled[0].value : []
  const projectApps = settled[1].status === 'fulfilled' ? settled[1].value : []
  const installedApps = settled[2].status === 'fulfilled' ? settled[2].value : []
  const miniApps = [...userApps]
  const ids = new Set(miniApps.map((entry) => entry.id))
  for (const entry of projectApps) if (!ids.has(entry.id)) miniApps.push(entry)
  const matchedMiniApps = miniApps
    .filter((entry) => matchesRemoteMentionApp({ id: entry.id, name: entry.manifest.name }, query))
    .slice(0, APP_RESULT_LIMIT)
    .map((entry) => ({ kind: 'miniapp', path: entry.id, label: entry.manifest.name,
      description: entry.manifest.description || entry.id, ...icon(miniAppIconDataUri(entry), iconsById) }))
  const matchedDesktopApps = installedApps
    .filter((entry) => matchesRemoteMentionApp({ id: entry.bundleId, name: entry.app, aliases: entry.aliases }, query))
    .slice(0, APP_RESULT_LIMIT)
  const desktopIcons = await Promise.allSettled(matchedDesktopApps.map((entry) => resolveAppIconDataUri(entry.bundleId)))
  return [...matchedMiniApps, ...matchedDesktopApps.map((entry, index) => ({ kind: 'desktop-app', path: entry.bundleId,
    label: entry.app, description: entry.bundleId,
    ...icon(boundedPngDataUri(desktopIcons[index]?.status === 'fulfilled' ? desktopIcons[index].value : undefined), iconsById) }))]
}

export interface RemoteMentionSearchOptions {
  /** Directory to confine the search to, relative to `cwd`. */
  scopeDir?: string
  /** Extra roots to search alongside `cwd`. */
  additionalDirs?: string[]
  /**
   * Answer with icon ids rather than icon bytes. The client caches the bytes
   * and fetches what it is missing once, instead of receiving every icon again
   * on every keystroke.
   */
  iconsById?: boolean
}

/** Search resources in the active cwd, but advertise only launchable provider
 * identities from the host's authoritative collaboration registry.
 *
 * The response echoes `cwd` and which options were applied. A client cannot
 * tell a scoped answer from an older host's project-wide one otherwise, and the
 * difference matters: an unscoped top-20 may have ranked the in-scope results
 * out entirely, so filtering it client-side would silently show less than the
 * directory actually holds. */
export async function searchRemoteMentions(
  projectPath: string,
  cwd: string,
  query: string,
  options: RemoteMentionSearchOptions = {},
) {
  const { listAgentMentionTargets } = await import('../session/agent-profiles')
  const agents = discoverAllAgents(projectPath).map((agent) => ({ name: agent.name, model: agent.model ?? '' }))
  const capabilityIds = availableMentionCapabilityIds(readAppSettings(), process.platform)
  const apps = await listRemoteMentionApps(projectPath, query, capabilityIds.includes('computer'), !!options.iconsById)
  const roots = [cwd, ...(options.additionalDirs ?? []).filter((dir) => dir && dir !== cwd)]
  return {
    items: [...apps, ...searchMentions(roots, query, agents, 20, options.scopeDir)],
    agentTargets: listAgentMentionTargets(),
    capabilityIds,
    cwd,
    appliedOptions: {
      scopeDir: options.scopeDir !== undefined,
      additionalDirs: roots.length > 1,
      iconsById: !!options.iconsById,
    },
  }
}
