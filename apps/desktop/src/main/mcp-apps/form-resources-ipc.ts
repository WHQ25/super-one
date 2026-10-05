import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { matchesResourceAccept } from '@superone/shared/mcp-form-resources'
import { McpAppsError, type McpAppReadResult } from '@superone/shared/mcp-apps'
import type { SchemaFormField, SchemaFormResource } from '@superone/shared/schema-form'
import type { Session } from '../session/types'
import { inputRequestPickContext } from '../session/input-requests'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { codexFormResources, type CodexFormResources } from '../codex/codex-form-resources'
import { inferMimeType } from '../file-bridge'
import { assertHostRenderer, hostProvider, hostRpcFailure, untilAborted } from './host-tools'

/** What the native picker needs: a pending Codex elicitation or a host input request. */
export type FormResourcePickContext = Pick<CodexFormResources, 'localFiles' | 'picked' | 'picking' | 'assertCurrent'> & {
  request: Pick<PermissionRequest, 'schemaForm' | 'serverName' | 'inputRequest'>
}

function resourceField(context: Pick<FormResourcePickContext, 'request' | 'assertCurrent'>, name: string): Extract<SchemaFormField, { kind: 'resource' }> {
  context.assertCurrent()
  const form = context.request.schemaForm
  const field = form?.supported ? form.fields.find(candidate => candidate.name === name) : undefined
  if (field?.kind !== 'resource') throw new McpAppsError('denied', 'The form has no such resource field')
  return field
}

/** The native picker is the only source of new paths. No renderer path/URI is an input. */
export async function pickFormResources(context: FormResourcePickContext, fieldName: string, pick: (options: OpenDialogOptions) => Promise<{ canceled: boolean; filePaths: string[] }>): Promise<SchemaFormResource[]> {
  const field = resourceField(context, fieldName)
  if (!context.localFiles || !field.userOptions) throw new McpAppsError('denied', 'This form cannot add local resources')
  if (context.picking) throw new McpAppsError('denied', 'A file picker is already open for this form')
  context.picking = true
  try {
    const { kind, accept } = field.userOptions
    const options: OpenDialogOptions = {
      title: `${context.request.inputRequest?.title ?? context.request.serverName} · ${field.label}`,
      message: context.request.inputRequest
        ? 'The selected paths will be shared with whoever opened this form when you submit it.'
        : 'The selected paths will be shared with this local MCP server when you submit the form.',
      properties: [kind === 'directory' ? 'openDirectory' : 'openFile', ...(field.selection === 'single' ? [] : ['multiSelections' as const])],
      // Filters are a convenience only. Mixed MIME/extension rules are checked below.
      ...(accept?.length && accept.every(rule => rule.startsWith('.'))
        ? { filters: [{ name: accept.join(', '), extensions: accept.map(rule => rule.slice(1)) }] } : {}),
    }
    const chosen = await pick(options)
    context.assertCurrent()
    if (chosen.canceled) return []
    if (field.selection === 'single' && chosen.filePaths.length > 1) throw new McpAppsError('invalid', 'Choose only one resource')
    const resources = await Promise.all([...new Set(chosen.filePaths)].map(async file => {
      if (!path.isAbsolute(file)) throw new McpAppsError('invalid', 'File path must be absolute')
      const canonical = await realpath(file)
      const info = await stat(canonical)
      if (kind === 'directory' ? !info.isDirectory() : !info.isFile()) throw new McpAppsError('invalid', 'The selected resource has the wrong kind')
      const mimeType = kind === 'file' ? inferMimeType(canonical) : undefined
      if (kind === 'file' && (!matchesResourceAccept(path.basename(file), inferMimeType(file), accept)
        || !matchesResourceAccept(path.basename(canonical), mimeType!, accept))) {
        throw new McpAppsError('denied', 'The selected file does not match the allowed file types')
      }
      return { uri: pathToFileURL(canonical).href, name: path.basename(canonical),
        ...(mimeType ? { mimeType, size: info.size } : {}) }
    }))
    context.assertCurrent()
    const existing = context.picked.get(fieldName) ?? []
    context.picked.set(fieldName, [...existing, ...resources.filter(resource => !existing.some(other => other.uri === resource.uri))])
    return resources
  } finally { context.picking = false }
}

/** Reads only the option's declared preview from the server/thread that elicited this pending form. */
export async function previewFormResource(session: Session, context: CodexFormResources, fieldName: string, optionUri: string): Promise<McpAppReadResult> {
  const field = resourceField(context, fieldName)
  const preview = field.options.find(option => option.uri === optionUri)?.preview
  if (preview?.type !== 'resource_link') throw new McpAppsError('denied', 'This option has no supported preview')
  const provider = await hostProvider(session, context.binding, context.origin, context.signal)
  try {
    context.assertCurrent()
    const result = await untilAborted(provider.readResource({ uri: preview.uri, origin: context.origin, transient: true }, context.signal), context.signal)
    context.assertCurrent()
    // Native provider/transport limits apply. Local IPC needs no additional byte cap.
    return result
  } finally { provider.dispose() }
}

export function registerMcpFormResourceIpc(getSession: (id: string) => Session | null): void {
  ipcMain.handle(AgentIpcChannels.MCP_FORM_PICK_RESOURCES, async (event, sessionId: string, requestId: string, field: string) => {
    try {
      assertHostRenderer(event)
      const context = inputRequestPickContext(sessionId, requestId) ?? codexFormResources(sessionId, requestId)
      const parent = BrowserWindow.fromWebContents(event.sender)
      return { ok: true, value: await pickFormResources(context, field, options => parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)) }
    } catch (error) { return hostRpcFailure(error) }
  })
  ipcMain.handle(AgentIpcChannels.MCP_FORM_PREVIEW_RESOURCE, async (event, sessionId: string, requestId: string, field: string, optionUri: string) => {
    try {
      assertHostRenderer(event)
      // Admission refuses preview targets on input forms; there is no server to read them from.
      if (inputRequestPickContext(sessionId, requestId)) throw new McpAppsError('denied', 'Input forms have no previews')
      const session = getSession(sessionId)
      if (!session) throw new McpAppsError('inactive', 'The form session is unavailable')
      return { ok: true, value: await previewFormResource(session, codexFormResources(sessionId, requestId), field, optionUri) }
    } catch (error) { return hostRpcFailure(error) }
  })
}
