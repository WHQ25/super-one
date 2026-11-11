import { ipcMain } from 'electron'
import path from 'node:path'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { boundedToolAppAttachment, compactMcpToolDescriptor, mcpAppResourceUri, McpAppsError, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { mcpAppFileExtension, mcpAppFileExtensions, type McpAppFileHandlersResult, type McpAppFileInput } from '@superone/shared/mcp-app-files'
import {
  hasMcpAppEntrypoint,
  mcpAppEntrypointKinds,
  parseMcpAppStandaloneSessionId,
  toMcpAppEntrypointDescriptor,
  type McpAppEntrypointHarness,
  type McpAppEntrypointKind,
  type McpAppGlobalEntrypointsQuery,
  type McpAppGlobalEntrypointsResult,
  type McpAppThreadEntrypointsResult,
} from '@superone/shared/mcp-app-entrypoints'
import { mcpAppPresentation, mcpAppPresentationIcon } from '@superone/shared/mcp-apps-metadata'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import type { McpAppsRpcResult } from '@superone/shared/environment/mcp-apps-rpc'
import type { Session } from '../session/types'
import { getMcpAppEntrypointsStore } from './entrypoints-cache'
import { hostOpenedApp, openHostEntrypointApp, openHostFileApp, releaseHostFileApp, releaseHostOpenedApp, updateHostFileApp, updateHostOpenedApp } from './host-files'
import { assertHostRenderer, findHostTools, hostProvider, hostRpcFailure, hostSessionResolver, untilAborted, type HostToolCandidate } from './host-tools'
import { findStandaloneGlobalEntrypointCandidate, getStandaloneMcpAppsProvider } from './standalone-provider'

interface Candidate extends HostToolCandidate { resourceUri: string }

async function fileTools(session: Session, extension: string, signal: AbortSignal): Promise<{ candidates: Candidate[]; incomplete: boolean }> {
  if (!extension) return { candidates: [], incomplete: false }
  const { candidates, incomplete } = await findHostTools(session, tool => !!mcpAppResourceUri(tool) && mcpAppFileExtensions(tool).includes(extension), signal)
  return { candidates: candidates.map(candidate => ({ ...candidate, resourceUri: mcpAppResourceUri(candidate.tool)! })), incomplete }
}

function sessionEntrypointHarness(session: Session): McpAppEntrypointHarness | undefined {
  const harness = session.snapshot.harnessId
  return harness === 'claude' || harness === 'codex' ? harness : undefined
}

async function entrypointTools(
  session: Session,
  projectPath: string,
  kind: McpAppEntrypointKind | 'any',
  signal: AbortSignal,
  serverFilter?: string,
): Promise<{ candidates: Candidate[]; incomplete: boolean }> {
  if (!session.getMcpAppsHostBindings || !session.getMcpAppsProvider) return { candidates: [], incomplete: false }
  const harness = sessionEntrypointHarness(session)
  const bindings = await session.getMcpAppsHostBindings()
  const filtered = serverFilter ? bindings.filter(item => item.binding.server === serverFilter) : bindings
  let incomplete = false
  const lists = await Promise.all(filtered.map(async ({ binding, origin }) => {
    try {
      const provider = await hostProvider(session, binding, origin, signal)
      try {
        const tools = [...(await untilAborted(provider.tools(), signal)).values()]
        if (harness) {
          getMcpAppEntrypointsStore().recordSessionTools(projectPath, harness, binding.server, binding.configFingerprint, tools)
        }
        return tools
          .filter(tool => kind === 'any' ? mcpAppEntrypointKinds(tool).length > 0 : hasMcpAppEntrypoint(tool, kind))
          .map(tool => ({ binding, origin, tool, resourceUri: mcpAppResourceUri(tool)! }))
      } finally {
        provider.dispose()
      }
    } catch (error) {
      if (serverFilter) throw error
      incomplete = true
      return []
    }
  }))
  return { candidates: lists.flat(), incomplete }
}

export function registerMcpAppFileIpc(getSession: (id: string) => Session | null, resumeSession: (id: string) => Session): void {
  const sessionFor = hostSessionResolver(getSession, resumeSession)

  ipcMain.handle(AgentIpcChannels.MCP_APP_FILE_HANDLERS, async (event, projectPath: string, sessionId: string, filePath: string, options?: { passive?: boolean }): Promise<McpAppsRpcResult<McpAppFileHandlersResult>> => {
    try {
      assertHostRenderer(event)
      if (parseRemoteProjectKey(projectPath)) return { ok: true, value: { handlers: [], unavailable: 'remote' } }
      const session = sessionFor(sessionId, options?.passive === true)
      if (!session) return { ok: true, value: { handlers: [], unavailable: 'no-session' } }
      const bindings = await session.getMcpAppsHostBindings?.({ start: options?.passive !== true }) ?? []
      if (!bindings.length) return { ok: true, value: { handlers: [], unavailable: 'no-session' } }
      const { candidates, incomplete } = await fileTools(session, mcpAppFileExtension(filePath), AbortSignal.timeout(15_000))
      return { ok: true, value: { ...(incomplete ? { incomplete: true as const } : {}), handlers: candidates.map(({ binding, tool }) => {
        const presentation = mcpAppPresentation(tool)
        const icon = mcpAppPresentationIcon(presentation)
        return { server: binding.server, tool: tool.name, title: presentation.toolTitle, ...(presentation.serverTitle ? { serverTitle: presentation.serverTitle } : {}), ...(icon ? { icon } : {}) }
      }) } }
    } catch (error) { return hostRpcFailure(error) }
  })

  ipcMain.handle(AgentIpcChannels.MCP_APP_OPEN_FILE, async (event, projectPath: string, sessionId: string, target: { server: string; tool: string; path: string }): Promise<McpAppsRpcResult<ToolAppAttachment>> => {
    try {
      assertHostRenderer(event)
      if (parseRemoteProjectKey(projectPath)) throw new McpAppsError('not_connected', 'Opening remote files with Apps is not supported yet')
      if (typeof target?.path !== 'string' || !path.isAbsolute(target.path) || typeof target.server !== 'string' || typeof target.tool !== 'string') throw new McpAppsError('invalid', 'Invalid file App request')
      const session = sessionFor(sessionId, false)
      if (!session?.getMcpAppsProvider) throw new McpAppsError('not_connected', 'MCP Apps session unavailable')
      const signal = AbortSignal.timeout(60_000)
      const candidate = (await fileTools(session, mcpAppFileExtension(target.path), signal)).candidates
        .find(value => value.binding.server === target.server && value.tool.name === target.tool)
      if (!candidate) throw new McpAppsError('denied', 'This App does not open this kind of file')
      const snapshot = session.snapshot
      const entry = await openHostFileApp({
        ref: { environmentId: 'local', sessionId }, projectPath, path: target.path,
        workspace: [snapshot.projectPath, snapshot.cwd].filter((value): value is string => !!value),
        app: { binding: candidate.binding, origin: candidate.origin, resourceUri: candidate.resourceUri, toolName: candidate.tool.name, toolDescriptor: compactMcpToolDescriptor(candidate.tool), presentation: mcpAppPresentation(candidate.tool) },
      })
      const input: McpAppFileInput = { file: entry.app.file }
      updateHostFileApp(entry, { toolInput: { ...input } })
      const provider = await session.getMcpAppsProvider(candidate.binding, candidate.origin)
      try {
        const { result } = await provider.callTool({ tool: candidate.tool.name, args: input, origin: candidate.origin }, signal)
        updateHostFileApp(entry, { toolResult: result, status: 'result' })
      } catch (error) {
        releaseHostFileApp(entry)
        throw error
      } finally { provider.dispose() }
      const { activateMcpAppHostView } = await import('./executor')
      activateMcpAppHostView(entry.ref, entry.app)
      return { ok: true, value: boundedToolAppAttachment(entry.app) }
    } catch (error) { return hostRpcFailure(error) }
  })

  ipcMain.handle(AgentIpcChannels.MCP_APP_THREAD_ENTRYPOINTS, async (event, projectPath: string, sessionId: string, options?: { passive?: boolean }): Promise<McpAppsRpcResult<McpAppThreadEntrypointsResult>> => {
    try {
      assertHostRenderer(event)
      if (parseRemoteProjectKey(projectPath)) return { ok: true, value: { entrypoints: [], unavailable: 'remote' } }
      const session = sessionFor(sessionId, options?.passive === true)
      if (!session) return { ok: true, value: { entrypoints: [], unavailable: 'no-session' } }
      const bindings = await session.getMcpAppsHostBindings?.({ start: options?.passive !== true }) ?? []
      if (!bindings.length) return { ok: true, value: { entrypoints: [], unavailable: 'no-session' } }
      const harness = sessionEntrypointHarness(session)
      const { candidates, incomplete } = await entrypointTools(session, projectPath, 'any', AbortSignal.timeout(15_000))
      const entrypoints = candidates
        .map(({ binding, tool }) => toMcpAppEntrypointDescriptor({ server: binding.server, tool, harness }))
        .filter((item): item is NonNullable<typeof item> => item !== null)
      return { ok: true, value: { entrypoints, ...(incomplete ? { incomplete: true as const } : {}) } }
    } catch (error) { return hostRpcFailure(error) }
  })

  ipcMain.handle(AgentIpcChannels.MCP_APP_OPEN_ENTRYPOINT, async (event, projectPath: string, sessionId: string, target: { server: string; tool: string; entrypoint: McpAppEntrypointKind }): Promise<McpAppsRpcResult<ToolAppAttachment>> => {
    try {
      assertHostRenderer(event)
      if (parseRemoteProjectKey(projectPath)) throw new McpAppsError('not_connected', 'Opening remote Apps directly is not supported yet')
      if (
        typeof target?.server !== 'string' || !target.server
        || typeof target?.tool !== 'string' || !target.tool
        || (target.entrypoint !== 'thread' && target.entrypoint !== 'global')
      ) {
        throw new McpAppsError('invalid', 'Invalid MCP App entrypoint request')
      }
      const signal = AbortSignal.timeout(60_000)
      const standalone = target.entrypoint === 'global' ? parseMcpAppStandaloneSessionId(sessionId) : null
      let candidate: Candidate | undefined
      let openProvider: () => Promise<Awaited<ReturnType<NonNullable<Session['getMcpAppsProvider']>>>>
      if (standalone) {
        candidate = await findStandaloneGlobalEntrypointCandidate(sessionId, target.server, target.tool, signal)
        openProvider = async () => getStandaloneMcpAppsProvider(candidate!.binding, candidate!.origin)
      } else {
        const session = sessionFor(sessionId, false)
        if (!session?.getMcpAppsProvider) throw new McpAppsError('not_connected', 'MCP Apps session unavailable')
        await session.getMcpAppsHostBindings?.({ start: true })
        candidate = (await entrypointTools(session, projectPath, target.entrypoint, signal, target.server)).candidates
          .find(value => value.binding.server === target.server && value.tool.name === target.tool)
        if (!candidate) throw new McpAppsError('denied', 'This MCP App does not declare that entrypoint')
        openProvider = () => session.getMcpAppsProvider!(candidate!.binding, candidate!.origin)
      }
      const { entry, reused } = openHostEntrypointApp({
        ref: { environmentId: 'local', sessionId },
        projectPath: standalone ? standalone.projectPath : projectPath,
        entrypoint: target.entrypoint,
        app: {
          binding: candidate.binding,
          origin: candidate.origin,
          resourceUri: candidate.resourceUri,
          toolName: candidate.tool.name,
          toolDescriptor: compactMcpToolDescriptor(candidate.tool),
          presentation: mcpAppPresentation(candidate.tool),
        },
      })
      const { activateMcpAppHostView } = await import('./executor')
      activateMcpAppHostView(entry.ref, entry.app)
      if (!reused) {
        updateHostOpenedApp(entry, { toolInput: {} })
        void (async () => {
          let provider: Awaited<ReturnType<NonNullable<Session['getMcpAppsProvider']>>> | undefined
          try {
            provider = await openProvider()
            const { result } = await provider.callTool({ tool: candidate.tool.name, args: {}, origin: candidate.origin }, signal)
            if (!hostOpenedApp(entry.ref, entry.app.appInstanceId)) return
            updateHostOpenedApp(entry, { toolResult: result, status: 'result' })
          } catch (error) {
            if (!hostOpenedApp(entry.ref, entry.app.appInstanceId)) return
            const mcpError = error instanceof McpAppsError
              ? error
              : new McpAppsError('not_connected', error instanceof Error ? error.message : String(error))
            updateHostOpenedApp(entry, { status: 'error', error: mcpError.toJSON() })
          } finally {
            provider?.dispose()
          }
        })()
      }
      return { ok: true, value: boundedToolAppAttachment(entry.app) }
    } catch (error) { return hostRpcFailure(error) }
  })

  ipcMain.handle(AgentIpcChannels.MCP_APP_GLOBAL_ENTRYPOINTS, async (event, projectPath: string, options?: McpAppGlobalEntrypointsQuery): Promise<McpAppsRpcResult<McpAppGlobalEntrypointsResult>> => {
    try {
      assertHostRenderer(event)
      return { ok: true, value: await getMcpAppEntrypointsStore().readGlobal(projectPath, options) }
    } catch (error) { return hostRpcFailure(error) }
  })

  ipcMain.handle(AgentIpcChannels.MCP_APP_CLOSE_FILE, (event, _projectPath: string, sessionId: string, appInstanceId: string) => {
    assertHostRenderer(event)
    if (typeof appInstanceId === 'string') releaseHostOpenedApp({ environmentId: 'local', sessionId }, appInstanceId)
  })
}
