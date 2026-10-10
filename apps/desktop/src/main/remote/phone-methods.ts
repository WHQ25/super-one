import type { HarnessId } from '@superone/shared/agent-types'
import type { SessionRef } from '@superone/shared/environment'
import { OPERATION_SCOPES } from '@superone/shared/environment'
import type { RpcContext, RpcExtensionDispatch, RpcResult } from '@superone/runtime/server'
import { mapThrown, requireScopes } from '@superone/runtime/server/rpc-helpers'
import type { AgentService } from '../agent/agent-service'

/**
 * What the phone methods ask of the desktop: the projections its window and
 * the phone link already build, shared with the old phone commands until the
 * phone client moves onto the protocol.
 */
export interface PhoneMethodHost {
  agent: Pick<AgentService,
    | 'remoteSystemInfo' | 'remoteProjectResources' | 'remoteHarnessOptions' | 'remoteAttachment' | 'remoteSessionActivity'
    | 'remoteSearchMentions' | 'remoteSearchMcpMentions' | 'remoteReadMcpMentions' | 'remoteMcpServers' | 'markRemoteSeen'
  >
  /** Phone-assisted desktop pairing; absent when this desktop cannot pair. */
  desktopPair?: (input: { kind: 'mint'; controllerName: string } | { kind: 'pair'; nodeCode: string; nodeName: string }) => Promise<unknown>
}

type Handler = (p: Record<string, unknown>, ctx: RpcContext) => unknown | Promise<unknown>

class InvalidArgument extends Error {
  readonly code = 'invalid_argument'
}

function text(p: Record<string, unknown>, key: string): string {
  const value = p[key]
  if (typeof value !== 'string' || !value) throw new InvalidArgument(`${key} is required`)
  return value
}

function optionalText(p: Record<string, unknown>, key: string): string | undefined {
  return typeof p[key] === 'string' && p[key] ? (p[key] as string) : undefined
}

function projectPath(ctx: RpcContext, projectId: string): string {
  const path = ctx.projects?.get(projectId)?.path
  if (!path) throw Object.assign(new Error('project not found'), { code: 'not_found' })
  return path
}

/** A session's project folder, as the desktop projections address it. */
function sessionProjectPath(ctx: RpcContext, sessionId: string): string {
  const record = ctx.sessions?.get(sessionId)
  if (!record) throw Object.assign(new Error('session not found'), { code: 'not_found' })
  return projectPath(ctx, record.projectId)
}

/** The paired device behind a phone's client session (`phone:<deviceId>`). */
function deviceOf(ctx: RpcContext): string {
  return ctx.client.clientSessionId.replace(/^phone:/, '')
}

function createHandlers(host: PhoneMethodHost): Record<string, Handler> {
  return {
    // Session reads beyond the shared session family.
    'session.historyIndex': async (p) => {
      const { loadSessionHistoryIndex } = await import('../session/history-navigation')
      return loadSessionHistoryIndex(text(p, 'sessionId'))
    },
    'session.attachment': (p, ctx) => {
      const sessionId = text(p, 'sessionId')
      sessionProjectPath(ctx, sessionId)
      const attachment = host.agent.remoteAttachment(sessionId, text(p, 'messageId'), { attachmentId: optionalText(p, 'attachmentId'), name: optionalText(p, 'name') ?? '' })
      if (!attachment?.base64) throw Object.assign(new Error('That attachment is no longer available'), { code: 'not_found' })
      return { attachment }
    },
    'session.activity': () => ({ sessions: host.agent.remoteSessionActivity() }),
    'session.linkMetadata': async (p) => {
      const { readSessionLinkCommand } = await import('./session-link-commands')
      return readSessionLinkCommand({ type: 'session_link_metadata', requestId: '', refs: (p.refs as SessionRef[] | undefined) ?? [] })
    },
    'session.linkResolve': async (p) => {
      const { readSessionLinkCommand } = await import('./session-link-commands')
      return readSessionLinkCommand({ type: 'session_link_resolve', requestId: '', ref: p.ref as SessionRef })
    },
    'environment.list': async () => {
      const { readSessionLinkCommand } = await import('./session-link-commands')
      return readSessionLinkCommand({ type: 'session_link_identity', requestId: '' })
    },

    // Session list pages as the phone's sidebar shows them.
    'sessionList.page': async (p, ctx) => {
      const { readRemoteSessionList } = await import('./session-lists')
      const limit = typeof p.limit === 'number' ? p.limit : undefined
      const offset = typeof p.offset === 'number' ? p.offset : undefined
      return readRemoteSessionList({ type: 'list_sessions', requestId: '', projectPath: projectPath(ctx, text(p, 'projectId')), limit, offset })
    },
    'sessionList.pinned': async () => {
      const { readRemoteSessionList } = await import('./session-lists')
      return readRemoteSessionList({ type: 'list_pinned_sessions', requestId: '' })
    },
    'sessionList.search': async (p) => {
      const { readRemoteSessionList } = await import('./session-lists')
      return readRemoteSessionList({ type: 'search_sessions', requestId: '', query: text(p, 'query'), limit: typeof p.limit === 'number' ? p.limit : undefined })
    },
    'sessionList.find': async (p) => {
      const { readRemoteSessionList } = await import('./session-lists')
      return readRemoteSessionList({ type: 'find_session', requestId: '', sessionId: text(p, 'sessionId') })
    },

    // Composer catalogs.
    'harness.systemInfo': (p, ctx) =>
      host.agent.remoteSystemInfo(projectPath(ctx, text(p, 'projectId')), text(p, 'harnessId') as HarnessId, p.force === true),
    'harness.projectResources': (p, ctx) =>
      host.agent.remoteProjectResources(projectPath(ctx, text(p, 'projectId')), text(p, 'harnessId') as HarnessId),
    'harness.options': () => host.agent.remoteHarnessOptions(),
    'workspace.searchMentions': (p, ctx) =>
      host.agent.remoteSearchMentions(projectPath(ctx, text(p, 'projectId')), typeof p.query === 'string' ? p.query : '', {
        scopeDir: optionalText(p, 'scopeDir'),
        additionalDirs: Array.isArray(p.additionalDirs) ? (p.additionalDirs as string[]) : undefined,
        iconsById: p.iconsById === true,
      }),
    'workspace.mentionIcons': async (p) => {
      const { lookupMentionIcons } = await import('../agent/remote-mention-icons')
      return { icons: lookupMentionIcons(Array.isArray(p.ids) ? (p.ids as string[]) : []) }
    },
    'mcp.searchMentions': (p, ctx) => {
      const sessionId = text(p, 'sessionId')
      return host.agent.remoteSearchMcpMentions(sessionProjectPath(ctx, sessionId), sessionId, typeof p.query === 'string' ? p.query : '')
    },
    'mcp.readMentions': (p, ctx) => {
      const sessionId = text(p, 'sessionId')
      const targets = Array.isArray(p.targets) ? (p.targets as Array<{ server: string; uri: string }>) : []
      return host.agent.remoteReadMcpMentions(sessionProjectPath(ctx, sessionId), sessionId, targets)
    },
    'mcp.list': (p, ctx) => host.agent.remoteMcpServers(projectPath(ctx, text(p, 'projectId'))),
    'mcp.icons': async (p, ctx) => {
      const { collectMcpServerIconMap, probeMcpIconsForAllHarnesses } = await import('../mcp-server-icons')
      const projectId = optionalText(p, 'projectId')
      void probeMcpIconsForAllHarnesses(projectId ? projectPath(ctx, projectId) : '')
      return { icons: await collectMcpServerIconMap() }
    },
    'media.listProviders': async () => {
      const { getMediaProviderStatuses } = await import('../media-gen/settings-service')
      // Labels only: the phone names params with these, it never configures providers.
      const providers = (await getMediaProviderStatuses()).map(({ id, label, providerLabel, models }) => ({
        id, label, ...(providerLabel ? { providerLabel } : {}), models,
      }))
      return { providers }
    },
    'environment.favicon': async (p) => {
      const { resolveFavicon } = await import('../favicon')
      return { dataUrl: await resolveFavicon(text(p, 'url'), p.isDark === true) }
    },
    'git.searchGithub': async (p) => {
      // The same services the desktop add-project dialog uses.
      const { listGithubReposForOwner, listMyGithubRepos, searchGithubRepositories } = await import('../plugins-service')
      if (p.mode === 'mine') return listMyGithubRepos(typeof p.page === 'number' ? p.page : 1, 20)
      if (p.mode === 'owner') return { repos: await listGithubReposForOwner(optionalText(p, 'value') ?? '') }
      return { repos: await searchGithubRepositories(optionalText(p, 'value') ?? '') }
    },
    'git.defaultClonePath': async () => {
      // A phone drives the desktop's own environment, which the sidebar keys `local`.
      const { readAppSettings } = await import('../app-settings-service')
      const saved = readAppSettings().defaultClonePaths?.local
      return { path: saved?.trim() ? saved.trim() : null }
    },
    'git.setDefaultClonePath': async (p) => {
      const { saveAppSettings } = await import('../app-settings-service')
      saveAppSettings({ defaultClonePaths: { local: text(p, 'path').trim() } })
      return { ok: true }
    },
    'widget.saveTemplate': async (p, ctx) => {
      // The store the renderer's own dialog writes, so a phone's template is indistinguishable.
      const { allocateTemplateId, saveTemplate } = await import('../generative-ui/template-store')
      const { superoneHome } = await import('../superone-home')
      const input = p.input as Parameters<typeof saveTemplate>[1]
      const projectId = optionalText(p, 'projectId')
      const roots = { project: projectId ? projectPath(ctx, projectId) : undefined, user: superoneHome() }
      if (input.scope === 'project' && !roots.project) throw new InvalidArgument('no project open')
      const saved = saveTemplate(roots, { ...input, id: allocateTemplateId(roots, input.id, input.scope) })
      return { template: { id: saved.id, scope: saved.scope, version: saved.version } }
    },

    // Client-scoped: about the phone itself, served by its paired desktop only.
    'client.markSeen': (p, ctx) => {
      const sessionId = text(p, 'sessionId')
      sessionProjectPath(ctx, sessionId)
      host.agent.markRemoteSeen(sessionId)
      return { ok: true }
    },
    'client.appendLog': async (p, ctx) => {
      const { appendMobileLog } = await import('./mobile-log')
      return { written: appendMobileLog(deviceOf(ctx), p.entries) }
    },
    'client.mintNodeCode': async (p) => {
      if (!host.desktopPair) throw new Error('Desktop pairing is unavailable')
      return host.desktopPair({ kind: 'mint', controllerName: text(p, 'controllerName') })
    },
    'client.pairNode': async (p) => {
      if (!host.desktopPair) throw new Error('Desktop pairing is unavailable')
      return host.desktopPair({ kind: 'pair', nodeCode: text(p, 'nodeCode'), nodeName: text(p, 'nodeName') })
    },
  }
}

/** Methods that only describe the phone or this desktop's window state, never an environment's resources. */
const CLIENT_SCOPED = new Set(['client.markSeen', 'client.appendLog', 'client.mintNodeCode', 'client.pairNode'])

/**
 * The desktop's methods for its phones beyond the shared families, as a
 * dispatcher extension: projections its window and the phone link already
 * build (session list pages, composer catalogs, mentions) and the
 * client-scoped methods.
 */
export function createPhoneMethods(host: PhoneMethodHost): { dispatch: RpcExtensionDispatch; methods: ReadonlySet<string> } {
  const handlers = createHandlers(host)
  const dispatch: RpcExtensionDispatch = async (method, payload, ctx): Promise<RpcResult | null> => {
    const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined
    if (!handler) return null
    const denied = requireScopes(ctx.client, CLIENT_SCOPED.has(method) ? OPERATION_SCOPES.readEnvironment : OPERATION_SCOPES.readSession)
    if (denied) return denied
    try {
      const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
      return { result: await handler(p, ctx) }
    } catch (err) {
      return mapThrown(err)
    }
  }
  return { dispatch, methods: new Set(Object.keys(handlers)) }
}
