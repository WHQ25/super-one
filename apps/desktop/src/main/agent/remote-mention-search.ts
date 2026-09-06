import { availableMentionCapabilityIds } from '@superone/shared/mention-capabilities'
import { nativeImage } from 'electron'
import { readAppSettings } from '../app-settings-service'
import { resolveAppIconDataUri } from '../computer-use/app-icon-resolver'
import { listInstalledApps } from '../computer-use/resolve-installed-app'
import { discoverApps, discoverProjectApps, validatePath } from '../miniapp/miniapp-service'
import { discoverAllAgents } from './discover-resources'
import { searchMentions } from './fuzzy-file-search'

const APP_RESULT_LIMIT = 12
const MAX_ICON_DATA_URI_LENGTH = 256_000

type SearchableApp = { id: string; name: string; aliases?: string[] }

export function matchesRemoteMentionApp(app: SearchableApp, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return !needle || [app.id, app.name, ...(app.aliases ?? [])].some((value) => value.toLowerCase().includes(needle))
}

function boundedPngDataUri(value: string | null | undefined): string | undefined {
  return value?.startsWith('data:image/png;base64,') && value.length <= MAX_ICON_DATA_URI_LENGTH ? value : undefined
}

function miniAppIconDataUri(entry: Awaited<ReturnType<typeof discoverApps>>[number]): string | undefined {
  const logo = entry.manifest.logo
  if (!logo) return
  const path = validatePath(entry.distDir ?? entry.installDir, logo)
  if (!path) return
  try {
    const source = nativeImage.createFromPath(path)
    if (source.isEmpty()) return
    const size = source.getSize()
    const image = Math.max(size.width, size.height) > 128
      ? source.resize(size.width >= size.height ? { width: 128, quality: 'best' } : { height: 128, quality: 'best' }) : source
    return boundedPngDataUri(image.toDataURL())
  } catch { return }
}

async function listRemoteMentionApps(projectPath: string, query: string, includeDesktopApps: boolean) {
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
      description: entry.manifest.description || entry.id, iconDataUri: miniAppIconDataUri(entry) }))
  const matchedDesktopApps = installedApps
    .filter((entry) => matchesRemoteMentionApp({ id: entry.bundleId, name: entry.app, aliases: entry.aliases }, query))
    .slice(0, APP_RESULT_LIMIT)
  const desktopIcons = await Promise.allSettled(matchedDesktopApps.map((entry) => resolveAppIconDataUri(entry.bundleId)))
  return [...matchedMiniApps, ...matchedDesktopApps.map((entry, index) => ({ kind: 'desktop-app', path: entry.bundleId,
    label: entry.app, description: entry.bundleId,
    iconDataUri: boundedPngDataUri(desktopIcons[index]?.status === 'fulfilled' ? desktopIcons[index].value : undefined) }))]
}

/** Search resources in the active cwd, but advertise only launchable provider
 * identities from the host's authoritative collaboration registry. */
export async function searchRemoteMentions(projectPath: string, cwd: string, query: string) {
  const { listAgentMentionTargets } = await import('../session/agent-profiles')
  const agents = discoverAllAgents(projectPath).map((agent) => ({ name: agent.name, model: agent.model ?? '' }))
  const capabilityIds = availableMentionCapabilityIds(readAppSettings(), process.platform)
  const apps = await listRemoteMentionApps(projectPath, query, capabilityIds.includes('computer'))
  return { items: [...apps, ...searchMentions([cwd], query, agents, 20)], agentTargets: listAgentMentionTargets(), capabilityIds }
}
