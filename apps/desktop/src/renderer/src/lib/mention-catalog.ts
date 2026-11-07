import { useSyncExternalStore } from 'react'
import type { MentionCatalog } from '@superone/shared/mention-catalog'

export const EMPTY_MENTION_CATALOG: MentionCatalog = { capabilityIds: [], apps: [], environments: [] }
const iconsByProject = new Map<string, Map<string, string>>()
const listeners = new Set<() => void>()
const iconKey = (kind: string, id: string) => JSON.stringify([kind, id])
const subscribe = (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback) } }
export function useMentionAppIcon(project: string | null, kind: string, id: string): string | undefined {
  return useSyncExternalStore(subscribe,
    () => project ? iconsByProject.get(project)?.get(iconKey(kind, id)) : undefined)
}

const pending = new Map<string, Promise<MentionCatalog>>()

/** Share overlapping composer/popup reads, without retaining stale host settings. */
export function loadMentionCatalog(projectPath: string): Promise<MentionCatalog> {
  const existing = pending.get(projectPath)
  if (existing) return existing
  const request = Promise.resolve().then(() => window.environment.getMentionCatalog(projectPath))
    .then(result => result && Array.isArray(result.capabilityIds) && Array.isArray(result.apps) ? result : EMPTY_MENTION_CATALOG)
    .then(catalog => {
      iconsByProject.set(projectPath, new Map(catalog.apps.flatMap(app => app.iconDataUri ? [[iconKey(app.kind, app.path), app.iconDataUri]] : [])))
      for (const listener of listeners) listener()
      return catalog
    })
    .catch(() => EMPTY_MENTION_CATALOG)
    .finally(() => { if (pending.get(projectPath) === request) pending.delete(projectPath) })
  pending.set(projectPath, request)
  return request
}
