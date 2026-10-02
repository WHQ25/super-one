import { ipcMain } from 'electron'
import path from 'node:path'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { boundedToolAppAttachment, mcpAppResourceUri, McpAppsError, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { mcpAppFileExtension, mcpAppFileExtensions, type McpAppFileHandlersResult, type McpAppFileInput } from '@superone/shared/mcp-app-files'
import { mcpAppPresentation, mcpAppPresentationIcon } from '@superone/shared/mcp-apps-metadata'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import type { McpAppsRpcResult } from '@superone/shared/environment/mcp-apps-rpc'
import type { Session } from '../session/types'
import { hostFileApp, openHostFileApp, releaseHostFileApp, updateHostFileApp } from './host-files'
import { assertHostRenderer, findHostTools, hostRpcFailure, hostSessionResolver, type HostToolCandidate } from './host-tools'

interface Candidate extends HostToolCandidate { resourceUri: string }

/** Tools whose file entrypoint accepts this extension. Visibility does not apply to entrypoints. */
async function fileTools(session: Session, extension: string, signal: AbortSignal): Promise<{ candidates: Candidate[]; incomplete: boolean }> {
  if (!extension) return { candidates: [], incomplete: false }
  const { candidates, incomplete } = await findHostTools(session, tool => !!mcpAppResourceUri(tool) && mcpAppFileExtensions(tool).includes(extension), signal)
  return { candidates: candidates.map(candidate => ({ ...candidate, resourceUri: mcpAppResourceUri(candidate.tool)! })), incomplete }
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
      // Re-derive the handler: the renderer names it, but only a declared entrypoint may open the file.
      const candidate = (await fileTools(session, mcpAppFileExtension(target.path), signal)).candidates
        .find(value => value.binding.server === target.server && value.tool.name === target.tool)
      if (!candidate) throw new McpAppsError('denied', 'This App does not open this kind of file')
      const snapshot = session.snapshot
      const entry = await openHostFileApp({
        ref: { environmentId: 'local', sessionId }, projectPath, path: target.path,
        workspace: [snapshot.projectPath, snapshot.cwd].filter((value): value is string => !!value),
        app: { binding: candidate.binding, origin: candidate.origin, resourceUri: candidate.resourceUri, toolName: candidate.tool.name, presentation: mcpAppPresentation(candidate.tool) },
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

  ipcMain.handle(AgentIpcChannels.MCP_APP_CLOSE_FILE, (event, _projectPath: string, sessionId: string, appInstanceId: string) => {
    assertHostRenderer(event)
    const entry = typeof appInstanceId === 'string' ? hostFileApp({ environmentId: 'local', sessionId }, appInstanceId) : undefined
    if (entry) releaseHostFileApp(entry)
  })
}
