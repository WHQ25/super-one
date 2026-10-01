import type { McpUiMessageRequest, McpUiRequestDisplayModeRequest } from '@modelcontextprotocol/ext-apps/app-bridge'
import { McpAppsError, type McpAppApprovalPrompt, type McpAppHostOperation, type McpAppHostResult, type McpAppReadResult, type McpAppsCallResult } from '@superone/shared/mcp-apps'
import type { McpAppHostExecutor } from '@superone/shared/mcp-apps-host'
import { NativeRequestTimeout, requestNative, requestNativeAsync } from './bridge'
import { markMcpAppInactive } from './mcp-app-document'

export type McpAppDisplayMode = McpUiRequestDisplayModeRequest['params']['mode']

/**
 * Operations the chat document sends through the `mcpApp` native action. The View never
 * names a session, server or binding: the document names its View, RN adds the session,
 * and the host resolves the attachment itself. Links open on the phone instead.
 */
export type McpAppOperation = Exclude<McpAppHostOperation, { operation: 'openLink' }>

export interface McpAppTarget {
  messageId: string
  appInstanceId: string
}

export interface McpAppConsent {
  /** `null` declines; `remember` asks the host to keep the approval for this tool. */
  approve(prompt: McpAppApprovalPrompt): Promise<{ remember: boolean } | null>
  confirmLink(url: string): Promise<boolean>
}

/** A tool call can outlive the default request timeout; its outcome is then unknown. */
const CALL_TIMEOUT_MS = 120_000

export async function requestMcpApp<T>(
  target: McpAppTarget,
  operation: McpAppOperation,
  approval?: { challenge: string; remember?: boolean },
): Promise<McpAppHostResult<T>> {
  const timeout = operation.operation === 'callTool' ? CALL_TIMEOUT_MS : undefined
  // Wrapped, because the shell's own acknowledgement (`ok: true`) would clobber the host's `ok`.
  const reply = await requestNativeAsync('mcpApp', { ...target, ...operation, ...(approval ? { approval } : {}) }, timeout) as { response: McpAppHostResult<T> }
  return reply.response
}

class Declined extends Error {}

/** Send an operation; when the host asks for approval, confirm here and resend the identical one. */
export async function runMcpAppOperation<T>(target: McpAppTarget, operation: McpAppOperation, consent: McpAppConsent): Promise<T> {
  let result = await requestMcpApp<T>(target, operation)
  if (!result.ok && result.error.code === 'approval_required') {
    const decision = await consent.approve(result.error.prompt)
    if (!decision) throw new Declined()
    result = await requestMcpApp<T>(target, operation, { challenge: result.error.challenge, ...(decision.remember ? { remember: true } : {}) })
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
  const run = <T>(operation: McpAppOperation) => runMcpAppOperation<T>(target, operation, consent)
  return {
    async callTool({ tool, args }) {
      try {
        return await run<McpAppsCallResult>({ operation: 'callTool', tool, args })
      } catch (error) {
        if (error instanceof Declined) throw new McpAppsError('denied', 'The call was not approved')
        // The request may have reached the server; the View must not retry it blindly.
        const unknown = error instanceof NativeRequestTimeout || (error instanceof McpAppsError && error.code === 'unknown_outcome')
        if (!unknown) throw error
        return {
          result: { content: [{ type: 'text', text: 'The result of this call is unknown. It was not retried.' }], isError: true },
          outcome: 'unknown_outcome',
        }
      }
    },
    async readResource({ uri }) {
      return run<McpAppReadResult>({ operation: 'readResource', uri })
    },
    async sendMessage(params) {
      try {
        return await run<{ isError?: boolean }>({ operation: 'sendMessage', params })
      } catch (error) {
        if (error instanceof Declined) return { isError: true }
        throw error
      }
    },
    async updateModelContext(context) {
      await run({ operation: 'updateModelContext', context })
    },
    async openLink({ url }) {
      if (!await consent.confirmLink(url)) return { isError: true }
      requestNative('openLink', { url })
      return {}
    },
    async requestDisplayMode(mode) {
      return display(mode)
    },
  }
}
