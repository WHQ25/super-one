import { rm } from 'fs/promises'
import { join } from 'path'
import { app, session } from 'electron'
import {
  BROWSER_DEFAULT_PARTITION,
  browserPartitionForProfile,
  DEFAULT_BROWSER_PROFILE_ID,
} from '@superone/shared/agent-types'
import { readAppSettings } from '../app-settings-service'

export {
  isMultiProfileEnabled,
  listAgentBrowserProfiles,
  resolveProfileForAgent,
  resolveProfileForUser,
} from './browser-profile-policy'

type SessionHook = (ses: Electron.Session, partition: string) => void

const PROFILE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/
const initializedPartitions = new Set<string>()
const browserSessions = new WeakSet<Electron.Session>()
const hookedSessions = new WeakSet<Electron.Session>()
const sessionHooks: SessionHook[] = []

function assertValidProfileId(profileId: string): string {
  if (!PROFILE_ID_RE.test(profileId)) {
    throw new Error(`Invalid browser profile id: ${profileId}`)
  }
  return profileId
}

export function isBrowserPartition(partition: string): boolean {
  return (
    partition === BROWSER_DEFAULT_PARTITION
    || (partition.startsWith('persist:browser-') && PROFILE_ID_RE.test(partition.slice('persist:browser-'.length)))
  )
}

export function registerBrowserSessionHook(hook: SessionHook): void {
  sessionHooks.push(hook)
  if (initializedPartitions.size === 0) {
    ensureBrowserPartition(BROWSER_DEFAULT_PARTITION)
    return
  }
  for (const partition of initializedPartitions) {
    const ses = session.fromPartition(partition)
    hook(ses, partition)
  }
}

export function ensureBrowserPartition(partition: string): Electron.Session {
  if (!session?.fromPartition) return undefined as unknown as Electron.Session
  const ses = session.fromPartition(partition)
  browserSessions.add(ses)
  if (!initializedPartitions.has(partition)) {
    initializedPartitions.add(partition)
  }
  if (!hookedSessions.has(ses)) {
    hookedSessions.add(ses)
    for (const hook of sessionHooks) {
      hook(ses, partition)
    }
  }
  return ses
}

export function ensureBrowserProfileSession(profileId?: string | null): Electron.Session {
  const id = profileId ? assertValidProfileId(profileId) : DEFAULT_BROWSER_PROFILE_ID
  return ensureBrowserPartition(browserPartitionForProfile(id))
}

export function isBrowserSession(ses: Electron.Session | null | undefined): boolean {
  return Boolean(ses && browserSessions.has(ses))
}

export function initAllBrowserProfileSessions(): void {
  try {
    const { browserProfiles } = readAppSettings()
    for (const profile of browserProfiles) {
      try {
        ensureBrowserProfileSession(profile.id)
      } catch {
        // skip invalid persisted profile ids
      }
    }
  } catch {
    ensureBrowserProfileSession(DEFAULT_BROWSER_PROFILE_ID)
  }
}

export async function clearBrowserProfileData(profileId: string, removeDirectory = false): Promise<void> {
  const id = assertValidProfileId(profileId)
  const partition = browserPartitionForProfile(id)
  if (session?.fromPartition) {
    const ses = session.fromPartition(partition)
    await ses.clearStorageData()
    await ses.clearCache()
    await ses.clearCodeCaches({})
    await ses.clearAuthCache()
  }
  if (removeDirectory && id !== DEFAULT_BROWSER_PROFILE_ID) {
    initializedPartitions.delete(partition)
    const dir = join(app.getPath('userData'), 'Partitions', `browser-${id}`)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
