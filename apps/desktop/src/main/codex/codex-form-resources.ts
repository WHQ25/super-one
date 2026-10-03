import type { PermissionRequest } from '@superone/shared/agent-types'
import { elicitationFormRequest, type SchemaForm, type SchemaFormResource } from '@superone/shared/schema-form'
import { McpAppsError, type McpAppsBinding, type McpAppOrigin } from '@superone/shared/mcp-apps'
import { mcpServerConfigFingerprint } from '@superone/runtime/mcp-apps/identity'
import { listCodexMcpConfigs } from '../codex-config-service'
import type { AppServerNotification } from './app-server-connection'
import type { CodexSession } from './codex-session'

/** Host-owned state, never serialized with a permission or persisted after it settles. */
export interface CodexFormResources {
  request: PermissionRequest
  projectPath: string
  binding: McpAppsBinding
  origin: McpAppOrigin
  localFiles: boolean
  picked: Map<string, SchemaFormResource[]>
  picking: boolean
  signal: AbortSignal
  assertCurrent(): void
}

const pending = new Map<string, CodexFormResources>()
const key = (session: string, request: string) => JSON.stringify([session, request])

export function codexFormResources(sessionId: string, requestId: string): CodexFormResources {
  const context = pending.get(key(sessionId, requestId))
  if (!context) throw new McpAppsError('inactive', 'The form is no longer pending')
  context.assertCurrent()
  return context
}

/** Prepare before emitting, but register only after the existing permission waiter owns the request. */
export function prepareCodexFormResources(session: CodexSession, notification: AppServerNotification, request: PermissionRequest): (() => () => void) | undefined {
  if (request.requestKind !== 'mcp_elicitation' || !request.schemaForm || !session.threadId || !request.serverName) return undefined
  const cwd = session.effectiveCwd ?? session.projectPath
  const config = listCodexMcpConfigs(cwd).find(server => server.name === request.serverName && !server.disabled)
  if (!config || config.name === 'codex_apps') return undefined
  const fingerprint = mcpServerConfigFingerprint(config)
  const parentThread = session.threadId
  const account = session.apiProviderId
  const localFiles = config.type === 'stdio'
  Object.assign(request, elicitationFormRequest(notification.params.requestedSchema, { userResources: localFiles }))
  const controller = new AbortController()
  const context: CodexFormResources = {
    request, projectPath: session.projectPath, localFiles, picked: new Map(), picking: false,
    binding: { node: 'local', session: session.superoneSessionId, server: config.name, account: account ?? undefined, configGeneration: 0, configFingerprint: fingerprint },
    origin: { providerSessionId: typeof notification.params.threadId === 'string' ? notification.params.threadId : parentThread },
    signal: controller.signal,
    assertCurrent() {
      const event = session.pendingApprovals.get(request.requestId)?.event
      const current = listCodexMcpConfigs(cwd).find(server => server.name === config.name && !server.disabled)
      if (controller.signal.aborted || event?.type !== 'permission_request' || event.request !== request
        || session.threadId !== parentThread || session.apiProviderId !== account
        || (session.effectiveCwd ?? session.projectPath) !== cwd
        || !current || mcpServerConfigFingerprint(current) !== fingerprint) {
        throw new McpAppsError('inactive', 'The form or its server binding changed')
      }
    },
  }
  return () => {
    const id = key(session.superoneSessionId, request.requestId)
    pending.set(id, context)
    return () => {
      controller.abort()
      context.picked.clear()
      if (pending.get(id) === context) pending.delete(id)
    }
  }
}

/** Only host-picked URIs extend the server's options during main-process answer validation. */
export function codexFormWithPickedResources(sessionId: string, requestId: string, form: SchemaForm | undefined): SchemaForm | undefined {
  const context = pending.get(key(sessionId, requestId))
  if (!context || !form?.supported) return form
  context.assertCurrent()
  return { supported: true, fields: form.fields.map(field => field.kind === 'resource' && field.userOptions
    ? { ...field, options: [...field.options, ...(context.picked.get(field.name) ?? [])] } : field) }
}
