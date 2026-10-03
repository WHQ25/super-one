import type { McpUiMessageRequest, McpUiRequestDisplayModeRequest } from '@modelcontextprotocol/ext-apps/app-bridge'
import { McpAppsError, type McpAppApprovalPrompt, type McpAppHostOperation, type McpAppHostResult, type McpAppReadResult, type McpAppsCallResult } from '@superone/shared/mcp-apps'
import type { McpAppHostExecutor } from '@superone/shared/mcp-apps-host'
import { NativeRequestTimeout, requestNative, requestNativeAsync } from './bridge'
import { isMcpAppHttpDownload, mcpAppDownloadName, type McpAppLocalDownload } from '@superone/shared/mcp-app-download'
import { markMcpAppInactive } from './mcp-app-document'

export type McpAppDisplayMode = McpUiRequestDisplayModeRequest['params']['mode']

/**
 * Operations the chat document sends through the `mcpApp` native action. The View never
 * names a session, server or binding: the document names its View, RN adds the session,
 * and the host resolves the attachment itself.
 */
export type McpAppOperation = McpAppHostOperation

export interface McpAppTarget {
  messageId: string
  appInstanceId: string
}

export interface McpAppConsent {
  /** Only a message the View wrote is confirmed; the user's own taps in the View are consent. */
  approve(prompt: McpAppApprovalPrompt, signal: AbortSignal): Promise<boolean>
}

/** The shell may fetch a linked file before it opens the preview. */
const DOWNLOAD_TIMEOUT_MS = 600_000
const DEFAULT_MIME_TYPE = 'application/octet-stream'

function localDownload(name: string, content: { mimeType?: string; text?: unknown; blob?: unknown }): McpAppLocalDownload {
  const mimeType = content.mimeType || DEFAULT_MIME_TYPE
  if (typeof content.text === 'string') return { name, mimeType, text: content.text }
  if (typeof content.blob === 'string') return { name, mimeType, base64: content.blob }
  throw new McpAppsError('invalid', 'The download has no content')
}

/** A tool call can outlive the default request timeout; its outcome is then unknown. */
const CALL_TIMEOUT_MS = 120_000

export async function requestMcpApp<T>(
  target: McpAppTarget,
  operation: McpAppOperation,
  approval?: { challenge: string },
): Promise<McpAppHostResult<T>> {
  const timeout = operation.operation === 'callTool' ? CALL_TIMEOUT_MS : undefined
  // Wrapped, because the shell's own acknowledgement (`ok: true`) would clobber the host's `ok`.
  const reply = await requestNativeAsync('mcpApp', { ...target, ...operation, ...(approval ? { approval } : {}) }, timeout) as { response: McpAppHostResult<T> }
  return reply.response
}

class Declined extends Error {}

function checkCancellation(signal: AbortSignal, toolDispatched = false): void {
  if (signal.aborted) throw new McpAppsError(toolDispatched ? 'unknown_outcome' : 'cancelled', 'MCP App request cancelled')
}

/** Send an operation; when the host asks for approval, confirm here and resend the identical one. */
export async function runMcpAppOperation<T>(target: McpAppTarget, operation: McpAppOperation, consent: McpAppConsent, signal = new AbortController().signal): Promise<T> {
  checkCancellation(signal)
  let result = await requestMcpApp<T>(target, operation)
  checkCancellation(signal, operation.operation === 'callTool')
  if (!result.ok && result.error.code === 'approval_required') {
    const approved = await consent.approve(result.error.prompt, signal)
    checkCancellation(signal)
    if (!approved) throw new Declined()
    result = await requestMcpApp<T>(target, operation, { challenge: result.error.challenge })
    checkCancellation(signal)
  }
  if (result.ok) return result.value
  if (result.error.code === 'approval_required') throw new McpAppsError('denied', 'The host asked for approval twice')
  if (result.error.code === 'inactive') markMcpAppInactive(target.appInstanceId)
  throw new McpAppsError(result.error.code, result.error.message, result.error.challenge)
}

export function mcpAppMessageText(message: McpUiMessageRequest['params']): string {
  return message.content.map((block) => (block.type === 'text' ? block.text : `[${block.type}]`)).join('\n')
}

export function createMcpAppExecutor(
  target: McpAppTarget,
  consent: McpAppConsent,
  display: (mode: McpAppDisplayMode) => McpAppDisplayMode,
): McpAppHostExecutor {
  const run = <T>(operation: McpAppOperation, signal: AbortSignal) => runMcpAppOperation<T>(target, operation, consent, signal)
  return {
    async callTool({ tool, args }, signal) {
      try {
        return await run<McpAppsCallResult>({ operation: 'callTool', tool, args }, signal)
      } catch (error) {
        // The request may have reached the server; the View must not retry it blindly.
        const unknown = error instanceof NativeRequestTimeout || (error instanceof McpAppsError && error.code === 'unknown_outcome') || (signal.aborted && !(error instanceof McpAppsError && error.code === 'cancelled'))
        if (!unknown) throw error
        return {
          result: { content: [{ type: 'text', text: 'The result of this call is unknown. It was not retried.' }], isError: true },
          outcome: 'unknown_outcome',
        }
      }
    },
    async readResource({ uri }, signal) {
      return run<McpAppReadResult>({ operation: 'readResource', uri }, signal)
    },
    async sendMessage(params, signal) {
      try {
        return await run<{ isError?: boolean }>({ operation: 'sendMessage', params }, signal)
      } catch (error) {
        if (error instanceof Declined) return { isError: true }
        throw error
      }
    },
    async updateModelContext(context, signal) {
      return run({ operation: 'updateModelContext', context }, signal)
    },
    async openLink({ url }, signal) {
      checkCancellation(signal)
      // Exactly what a link in the transcript does: the shell checks the scheme and hands it
      // to the system browser.
      requestNative('openLink', { url })
      return {}
    },
    async requestDisplayMode(mode, signal) {
      checkCancellation(signal)
      return display(mode)
    },
    async downloadFile(contents, signal) {
      // The bytes land on this phone. Only a link to the View's own server needs the host.
      const items: McpAppLocalDownload[] = []
      for (const item of contents) {
        const name = mcpAppDownloadName(item)
        if (item.type === 'resource') { items.push(localDownload(name, item.resource)); continue }
        if (isMcpAppHttpDownload(item.uri)) { items.push({ name, mimeType: item.mimeType ?? DEFAULT_MIME_TYPE, url: item.uri }); continue }
        const read = await run<McpAppReadResult>({ operation: 'readResource', uri: item.uri }, signal)
        const content = read.contents.find((value) => value.uri === item.uri) ?? read.contents[0]
        if (!content) throw new McpAppsError('invalid', 'The linked resource is empty')
        items.push(localDownload(name, { ...content, mimeType: content.mimeType ?? item.mimeType }))
      }
      checkCancellation(signal)
      await requestNativeAsync('mcpAppDownload', { items }, DOWNLOAD_TIMEOUT_MS)
      return {}
    },
  }
}
