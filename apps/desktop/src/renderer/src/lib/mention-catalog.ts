import { useEffect, useState, useSyncExternalStore } from 'react'
import type { MentionCatalog } from '@superone/shared/mention-catalog'
import { parseRemoteProjectKey } from './remote-project-key'

export const EMPTY_MENTION_CATALOG: MentionCatalog = { capabilityIds: [], apps: [], environments: [] }

const catalogByProject = new Map<string, MentionCatalog>()
const iconsByProject = new Map<string, Map<string, string>>()
const pending = new Map<string, Promise<MentionCatalog>>()
const latestRequestByProject = new Map<string, number>()
const mountedProjects = new Map<string, number>()
const listeners = new Set<() => void>()
const hostUnsubscribers = new Set<() => void>()
let subscribedHostFns = new WeakSet<object>()

const iconKey = (kind: string, id: string) => JSON.stringify([kind, id])
const subscribe = (callback: () => void) => {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

function sameStrings(a?: readonly string[], b?: readonly string[]): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function sameMentionCatalog(a: MentionCatalog | undefined, b: MentionCatalog): boolean {
  if (!a) return false
  if (a === b) return true
  if (a.chromeBridgeConnected !== b.chromeBridgeConnected) return false
  if (!sameStrings(a.capabilityIds, b.capabilityIds)) return false
  if (!sameStrings(a.connectedBrowsers, b.connectedBrowsers)) return false
  if (a.apps.length !== b.apps.length) return false
  for (let i = 0; i < a.apps.length; i++) {
    const x = a.apps[i]
    const y = b.apps[i]
    if (x.kind !== y.kind || x.path !== y.path || x.label !== y.label || x.iconDataUri !== y.iconDataUri) return false
    if (!sameStrings(x.aliases, y.aliases)) return false
  }
  const envA = a.environments ?? []
  const envB = b.environments ?? []
  if (envA.length !== envB.length) return false
  for (let i = 0; i < envA.length; i++) {
    const x = envA[i]
    const y = envB[i]
    if (x.role !== y.role || x.id !== y.id || x.label !== y.label || x.status !== y.status) return false
  }
  return true
}

function storeCatalog(projectPath: string, catalog: MentionCatalog): void {
  if (sameMentionCatalog(catalogByProject.get(projectPath), catalog)) return
  catalogByProject.set(projectPath, catalog)
  iconsByProject.set(
    projectPath,
    new Map(catalog.apps.flatMap((app) => (app.iconDataUri ? [[iconKey(app.kind, app.path), app.iconDataUri]] : []))),
  )
  emit()
}

function refreshLocalCatalogs(): void {
  const localProjects = new Set<string>()
  for (const projectPath of catalogByProject.keys()) {
    if (!parseRemoteProjectKey(projectPath)) localProjects.add(projectPath)
  }
  for (const projectPath of mountedProjects.keys()) {
    if (!parseRemoteProjectKey(projectPath)) localProjects.add(projectPath)
  }
  for (const projectPath of localProjects) {
    void loadMentionCatalog(projectPath, { fresh: true })
  }
}

function ensureHostSubscriptions(): void {
  if (typeof window === 'undefined') return
  const register = (fn: ((cb: () => void) => () => void) | undefined) => {
    if (typeof fn !== 'function' || subscribedHostFns.has(fn)) return
    subscribedHostFns.add(fn)
    const unsub = fn(() => refreshLocalCatalogs())
    if (typeof unsub === 'function') hostUnsubscribers.add(unsub)
  }
  register(window.app?.onAppSettingsChange as ((cb: () => void) => () => void) | undefined)
  register(window.app?.onChromeBridgeStatus as ((cb: () => void) => () => void) | undefined)
}

export function peekMentionCatalog(projectPath: string | null | undefined): MentionCatalog | undefined {
  return projectPath ? catalogByProject.get(projectPath) : undefined
}

export function useMentionAppIcon(project: string | null, kind: string, id: string): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (project ? iconsByProject.get(project)?.get(iconKey(kind, id)) : undefined),
  )
}

export function loadMentionCatalog(projectPath: string, opts?: { fresh?: boolean }): Promise<MentionCatalog> {
  ensureHostSubscriptions()
  if (!opts?.fresh) {
    const existing = pending.get(projectPath)
    if (existing) return existing
  }
  const generation = (latestRequestByProject.get(projectPath) ?? 0) + 1
  latestRequestByProject.set(projectPath, generation)
  const request = Promise.resolve()
    .then(() => window.environment.getMentionCatalog(projectPath))
    .then((result) => {
      const valid = result && Array.isArray(result.capabilityIds) && Array.isArray(result.apps)
      if (!valid) return catalogByProject.get(projectPath) ?? EMPTY_MENTION_CATALOG
      if (latestRequestByProject.get(projectPath) === generation) {
        storeCatalog(projectPath, result)
      }
      return result
    })
    .catch(() => catalogByProject.get(projectPath) ?? EMPTY_MENTION_CATALOG)
    .finally(() => {
      if (pending.get(projectPath) === request) pending.delete(projectPath)
    })
  pending.set(projectPath, request)
  return request
}

export function useMentionCatalog(projectPath: string | null): { catalog: MentionCatalog; ready: boolean } {
  const cached = useSyncExternalStore(
    subscribe,
    () => (projectPath ? catalogByProject.get(projectPath) : undefined),
  )
  const [settledProject, setSettledProject] = useState<string | null>(null)

  useEffect(() => {
    if (!projectPath) return
    ensureHostSubscriptions()
    mountedProjects.set(projectPath, (mountedProjects.get(projectPath) ?? 0) + 1)
    let cancelled = false
    void loadMentionCatalog(projectPath).finally(() => {
      if (!cancelled) setSettledProject(projectPath)
    })
    return () => {
      cancelled = true
      const next = (mountedProjects.get(projectPath) ?? 1) - 1
      if (next <= 0) mountedProjects.delete(projectPath)
      else mountedProjects.set(projectPath, next)
    }
  }, [projectPath])

  return {
    catalog: cached ?? EMPTY_MENTION_CATALOG,
    ready: !projectPath || cached !== undefined || settledProject === projectPath,
  }
}

export function clearMentionCatalogCache(): void {
  catalogByProject.clear()
  iconsByProject.clear()
  pending.clear()
  latestRequestByProject.clear()
  mountedProjects.clear()
  for (const unsub of hostUnsubscribers) unsub()
  hostUnsubscribers.clear()
  subscribedHostFns = new WeakSet<object>()
  emit()
}
