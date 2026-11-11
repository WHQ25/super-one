import { useMemo } from 'react'
import { create } from 'zustand'
import type { HarnessId } from '@superone/shared/agent-types'
import { McpAppsError } from '@superone/shared/mcp-apps'
import {
  filterMcpAppEntrypointsForContext,
  mcpAppStandaloneSessionId,
  mcpAppThreadEntrypointKey,
  normalizeMcpAppEntrypointKinds,
  resolveMcpAppEntrypointHarness,
  type McpAppEntrypointDescriptor,
  type McpAppEntrypointHarness,
  type McpAppEntrypointKind,
  type McpAppGlobalEntrypointsQuery,
  type McpAppGlobalEntrypointsResult,
  type McpAppThreadEntrypointsResult,
} from '@superone/shared/mcp-app-entrypoints'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { useChatStore } from '@/stores/chat'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'
import type { McpAppRoute } from './desktop-executor'
import { navigateMcpAppSession } from './session-navigation'
import { useMcpAppLayout } from './layout-store'

export type McpAppThreadEntrypointsState =
  | { status: 'loading' }
  | { status: 'ready'; entrypoints: McpAppEntrypointDescriptor[]; unavailable?: McpAppThreadEntrypointsResult['unavailable']; incomplete?: true }
  | { status: 'error'; message?: string }

export type McpAppGlobalEntrypointsState =
  | { status: 'loading'; entrypoints: McpAppEntrypointDescriptor[]; incomplete?: true }
  | { status: 'ready'; entrypoints: McpAppEntrypointDescriptor[]; unavailable?: McpAppGlobalEntrypointsResult['unavailable']; incomplete?: true }
  | { status: 'error'; entrypoints: McpAppEntrypointDescriptor[]; message?: string }

export interface ActiveMcpAppDrawerContext {
  projectPath: string
  sessionId: string | null
  hasSession: boolean
  provider: HarnessId | null
  harness: McpAppEntrypointHarness | null
  isEmptyDraft: boolean
}

const THREAD_TTL_MS = 30_000
const threadFetchedAt = new Map<string, number>()
const threadCacheKey = (route: McpAppRoute) => JSON.stringify([route.projectPath, route.sessionId])

let subscribedHostUpdatedFn: Window['environment']['onMcpAppHostUpdated'] | null = null
let unsubscribeHostUpdated: (() => void) | null = null

function ensureHostUpdatedSubscription(): void {
  if (typeof window === 'undefined') return
  const subscribe = window.environment?.onMcpAppHostUpdated
  if (!subscribe || subscribedHostUpdatedFn === subscribe) return
  unsubscribeHostUpdated?.()
  subscribedHostUpdatedFn = subscribe
  unsubscribeHostUpdated = subscribe((event) => {
    useMcpAppLayout.getState().updateHostApp(event.appInstanceId, event.update)
  })
}

export const useMcpAppThreadEntrypointCache = create<{ entries: Record<string, McpAppThreadEntrypointsState> }>(() => ({
  entries: {},
}))

export const useMcpAppGlobalEntrypointStore = create<{
  projects: Record<string, McpAppGlobalEntrypointsState>
}>(() => ({
  projects: {},
}))

export function useActiveMcpAppDrawerContext(projectPath: string): ActiveMcpAppDrawerContext {
  const activeProject = useChatStore(state => state.activeProject)
  const resolvedProject = projectPath || activeProject || ''
  const sessionId = useChatStore(state => (
    resolvedProject ? state.projectSessions[resolvedProject]?._activeSessionId ?? null : null
  ))
  const perSession = useChatStore(state => (
    resolvedProject && sessionId ? state.projectSessions[resolvedProject]?._sessions[sessionId] : undefined
  ))
  const hasSession = Boolean(sessionId && perSession)
  const provider = perSession ? resolveProvider(perSession) : null
  const harness = resolveMcpAppEntrypointHarness(provider)
  const isEmptyDraft = Boolean(
    perSession
    && perSession.messages.length === 0
    && !perSession.awaitingAssistantReply,
  )
  return useMemo(() => ({
    projectPath: resolvedProject,
    sessionId,
    hasSession,
    provider,
    harness,
    isEmptyDraft,
  }), [resolvedProject, sessionId, hasSession, provider, harness, isEmptyDraft])
}

async function resolveLocalProjectId(projectPath: string): Promise<string> {
  const api = window.environment
  if (typeof api.listProjects !== 'function') return projectPath
  const normalized = projectPath.replace(/\/$/, '')
  const projects = await api.listProjects('local')
  const match = projects.find(project => project.path.replace(/\/$/, '') === normalized)
  if (!match?.projectId) {
    throw new McpAppsError('not_connected', 'This project is not registered on its host. Open it again.')
  }
  return match.projectId
}

async function materializeLocalRoute(
  route: McpAppRoute,
  preferredHarness?: McpAppEntrypointHarness,
): Promise<McpAppRoute> {
  if (parseRemoteProjectKey(route.projectPath)) return route
  const state = useChatStore.getState()
  const perSession = state.projectSessions[route.projectPath]?._sessions[route.sessionId]
  const resolved = perSession ? resolveProvider(perSession) : null
  const harnessId: McpAppEntrypointHarness = resolved === 'codex' || resolved === 'claude'
    ? resolved
    : (preferredHarness ?? 'claude')
  const hasHostedTurn = Boolean(perSession?.messages.some(message => message.providerId !== 'local'))
  const existing = await window.environment.getSession('local', route.sessionId).catch(() => null) as { harnessId?: string } | null
  if (existing && (!existing.harnessId || existing.harnessId === harnessId || hasHostedTurn)) return route
  if (existing && existing.harnessId && existing.harnessId !== harnessId && !hasHostedTurn) {
    await window.environment.removeSession?.('local', route.sessionId)
  }
  const projectId = await resolveLocalProjectId(route.projectPath)
  const cwd = perSession?._worktreePath ?? perSession?.cwd ?? route.projectPath
  const created = await window.environment.createSession('local', {
    projectId,
    harnessId,
    cwd,
    selections: { sessionId: route.sessionId },
  })
  const nextRoute = { projectPath: route.projectPath, sessionId: created.sessionId }
  await navigateMcpAppSession(nextRoute)
  return nextRoute
}

export function prefetchThreadMcpAppEntrypoints(
  route: McpAppRoute | null,
  options: { force?: boolean; passive?: boolean } = {},
): void {
  ensureHostUpdatedSubscription()
  if (!route?.projectPath || !route.sessionId) return
  const api = window.environment?.mcpAppThreadEntrypoints
  if (!api) return
  const key = threadCacheKey(route)
  const previous = threadFetchedAt.get(key)
  if (!options.force && previous !== undefined && Date.now() - previous < THREAD_TTL_MS) return
  threadFetchedAt.set(key, Date.now())
  const setEntry = (value: McpAppThreadEntrypointsState) =>
    useMcpAppThreadEntrypointCache.setState(state => ({ entries: { ...state.entries, [key]: value } }))
  if (!options.passive && (!useMcpAppThreadEntrypointCache.getState().entries[key] || options.force)) {
    setEntry({ status: 'loading' })
  }

  void (async () => {
    const activeRoute = options.passive ? route : await materializeLocalRoute(route).catch(() => route)
    const result = await api(activeRoute.projectPath, activeRoute.sessionId, { passive: options.passive })
    if (!result.ok) throw new Error(result.error.message)
    if (result.value.incomplete || (options.passive && result.value.unavailable === 'no-session')) {
      threadFetchedAt.delete(key)
      if (options.passive && result.value.unavailable === 'no-session') return
      if (useMcpAppThreadEntrypointCache.getState().entries[key]?.status === 'ready' && !options.force) return
    }
    setEntry({ status: 'ready', ...result.value })
  })().catch((error: unknown) => {
    threadFetchedAt.delete(key)
    if (!options.passive && useMcpAppThreadEntrypointCache.getState().entries[key]?.status !== 'ready') {
      setEntry({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  })
}

export function useThreadMcpAppEntrypoints(route: McpAppRoute | null): McpAppThreadEntrypointsState | undefined {
  const key = route?.projectPath && route.sessionId ? threadCacheKey(route) : ''
  return useMcpAppThreadEntrypointCache(state => key ? state.entries[key] : undefined)
}

export function useVisibleMcpAppEntrypoints(projectPath: string) {
  const context = useActiveMcpAppDrawerContext(projectPath)
  const bucket = context.projectPath
  const globalEntry = useMcpAppGlobalEntrypointStore(state => state.projects[bucket])
  const sessionRoute = useMemo<McpAppRoute | null>(
    () => (context.hasSession && context.sessionId && context.harness ? { projectPath: bucket, sessionId: context.sessionId } : null),
    [bucket, context.hasSession, context.sessionId, context.harness],
  )
  const threadEntry = useThreadMcpAppEntrypoints(sessionRoute)

  const entrypoints = useMemo(() => {
    const combined = [
      ...(globalEntry?.entrypoints ?? []),
      ...(threadEntry?.status === 'ready' ? threadEntry.entrypoints : []),
    ]
    return filterMcpAppEntrypointsForContext(combined, {
      hasSession: context.hasSession,
      provider: context.provider,
      isEmptyDraft: context.isEmptyDraft,
    })
  }, [globalEntry?.entrypoints, threadEntry, context.hasSession, context.provider, context.isEmptyDraft])

  const supportedContext = !context.hasSession || Boolean(context.harness)
  const loading = supportedContext && (globalEntry?.status === 'loading' || threadEntry?.status === 'loading')
  const incomplete = supportedContext && Boolean(
    (globalEntry && 'incomplete' in globalEntry && globalEntry.incomplete)
    || (threadEntry?.status === 'ready' && threadEntry.incomplete),
  )

  return {
    context,
    entrypoints,
    loading,
    incomplete,
  }
}

export function findOpenEntrypointViewKey(sessionId: string, server: string, tool: string): string | undefined {
  const target = mcpAppThreadEntrypointKey(sessionId, server, tool)
  for (const [key, owner] of Object.entries(useMcpAppLayout.getState().views)) {
    if (!owner.onClose || owner.app.file) continue
    const candidate = mcpAppThreadEntrypointKey(owner.route.sessionId, owner.app.binding.server, owner.app.toolName ?? '')
    if (candidate === target) return key
  }
  return undefined
}

export async function openEntrypointInSession(
  route: McpAppRoute,
  descriptor: McpAppEntrypointDescriptor,
  entrypoint: McpAppEntrypointKind,
  maximized = false,
  preferredHarness?: McpAppEntrypointHarness,
): Promise<void> {
  ensureHostUpdatedSubscription()
  const existingKey = findOpenEntrypointViewKey(route.sessionId, descriptor.server, descriptor.tool)
  if (existingKey) {
    useMcpAppLayout.getState().setMode(existingKey, 'fullscreen', maximized)
    return
  }
  const activeRoute = await materializeLocalRoute(route, preferredHarness ?? descriptor.harness)
  const rechecked = findOpenEntrypointViewKey(activeRoute.sessionId, descriptor.server, descriptor.tool)
  if (rechecked) {
    useMcpAppLayout.getState().setMode(rechecked, 'fullscreen', maximized)
    return
  }
  const api = window.environment
  const result = await api.mcpAppOpenEntrypoint(activeRoute.projectPath, activeRoute.sessionId, {
    server: descriptor.server,
    tool: descriptor.tool,
    entrypoint,
  })
  if (!result.ok) throw new McpAppsError(result.error.code, result.error.message)
  const app = result.value
  useMcpAppLayout.getState().openHost({
    app,
    route: activeRoute,
    api,
    title: descriptor.title,
    toolName: `mcp__${descriptor.server}__${descriptor.tool}`,
    onClose: () => { void api.mcpAppCloseFile(activeRoute.projectPath, activeRoute.sessionId, app.appInstanceId).catch(() => {}) },
  }, maximized)
}

export async function openThreadMcpApp(
  route: McpAppRoute,
  descriptor: McpAppEntrypointDescriptor,
  maximized = false,
): Promise<void> {
  return openEntrypointInSession(route, descriptor, 'thread', maximized, descriptor.harness)
}

export async function loadGlobalMcpAppEntrypoints(
  projectPath: string,
  options: McpAppGlobalEntrypointsQuery = {},
): Promise<void> {
  ensureHostUpdatedSubscription()
  const bucket = projectPath || ''
  const api = window.environment?.mcpAppGlobalEntrypoints
  if (!api) return
  const current = useMcpAppGlobalEntrypointStore.getState().projects[bucket]
  if (options.discover) {
    useMcpAppGlobalEntrypointStore.setState(state => ({
      projects: {
        ...state.projects,
        [bucket]: {
          status: 'loading',
          entrypoints: current?.entrypoints ?? [],
          ...(current && 'incomplete' in current && current.incomplete ? { incomplete: true as const } : {}),
        },
      },
    }))
  }
  try {
    const result = await api(bucket, options)
    if (!result.ok) throw new Error(result.error.message)
    useMcpAppGlobalEntrypointStore.setState(state => ({
      projects: {
        ...state.projects,
        [bucket]: {
          status: 'ready',
          entrypoints: result.value.entrypoints,
          ...(result.value.unavailable ? { unavailable: result.value.unavailable } : {}),
          ...(result.value.incomplete ? { incomplete: true as const } : {}),
        },
      },
    }))
  } catch (error) {
    useMcpAppGlobalEntrypointStore.setState(state => ({
      projects: {
        ...state.projects,
        [bucket]: {
          status: 'error',
          entrypoints: current?.entrypoints ?? [],
          message: error instanceof Error ? error.message : String(error),
        },
      },
    }))
  }
}

export async function openGlobalMcpApp(
  projectPath: string,
  descriptor: McpAppEntrypointDescriptor,
  maximized = false,
  preferredHarness?: McpAppEntrypointHarness,
): Promise<void> {
  ensureHostUpdatedSubscription()
  const normalizedProject = projectPath || ''
  if (normalizedProject && parseRemoteProjectKey(normalizedProject)) {
    throw new McpAppsError('not_connected', 'Opening remote Apps directly is not supported yet')
  }
  const harnessId: McpAppEntrypointHarness = preferredHarness ?? descriptor.harness ?? 'claude'
  const sessionId = mcpAppStandaloneSessionId(harnessId, normalizedProject)
  const existingKey = findOpenEntrypointViewKey(sessionId, descriptor.server, descriptor.tool)
  if (existingKey) {
    useMcpAppLayout.getState().setMode(existingKey, 'fullscreen', maximized)
    return
  }
  const route: McpAppRoute = { projectPath: normalizedProject, sessionId }
  const api = window.environment
  const opened = await api.mcpAppOpenEntrypoint(route.projectPath, route.sessionId, {
    server: descriptor.server,
    tool: descriptor.tool,
    entrypoint: 'global',
  })
  if (!opened.ok) throw new McpAppsError(opened.error.code, opened.error.message)
  const app = opened.value
  useMcpAppLayout.getState().openHost({
    app,
    route,
    api,
    title: descriptor.title,
    toolName: `mcp__${descriptor.server}__${descriptor.tool}`,
    onClose: () => { void api.mcpAppCloseFile(route.projectPath, route.sessionId, app.appInstanceId).catch(() => {}) },
  }, maximized)
}

export async function openMcpAppFromDrawer(
  context: ActiveMcpAppDrawerContext,
  descriptor: McpAppEntrypointDescriptor,
  maximized = false,
): Promise<void> {
  const kinds = normalizeMcpAppEntrypointKinds(descriptor.kinds)
  const openInActiveSession = Boolean(
    context.hasSession
    && context.sessionId
    && context.projectPath
    && kinds.includes('thread')
    && (!context.isEmptyDraft || !kinds.includes('global')),
  )
  if (openInActiveSession && context.sessionId) {
    await openEntrypointInSession(
      { projectPath: context.projectPath, sessionId: context.sessionId },
      descriptor,
      'thread',
      maximized,
      context.harness ?? descriptor.harness,
    )
    return
  }

  const targetHarness = context.harness ?? descriptor.harness ?? 'claude'
  await openGlobalMcpApp(context.projectPath, descriptor, maximized, targetHarness)
}
