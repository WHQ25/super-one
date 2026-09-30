import type { McpUiMessageRequest, McpUiRequestDisplayModeRequest } from '@modelcontextprotocol/ext-apps/app-bridge'
import { McpAppsError, type McpAppModelContext, type McpAppReadResult, type McpAppsCallResult, type McpAppsErrorData } from '@superone/shared/mcp-apps'
import type { McpAppHostExecutor } from '@superone/shared/mcp-apps-host'
import { NativeRequestTimeout, requestNative, requestNativeAsync } from './bridge'

export type McpAppDisplayMode = McpUiRequestDisplayModeRequest['params']['mode']

/**
 * Operations the chat document sends through the `mcpApp` native action. The View never
 * names a session, server or binding: the document names its View, RN adds the session,
 * and the host resolves the attachment itself. Links are the exception: the phone opens
 * them locally, after its own confirmation.
 */
export type McpAppOperation =
  | { operation: 'load' }
  | { operation: 'activate' }
  | { operation: 'callTool'; tool: string; args: Record<string, unknown> }
  | { operation: 'readResource'; uri: string }
  | { operation: 'sendMessage'; params: McpUiMessageRequest['params'] }
  | { operation: 'updateModelContext'; context: McpAppModelContext }

/**
 * What the host wants confirmed, rendered as plain text by the device that shows the View.
 * Mirrors the host contract; `openLink` never reaches the phone.
 */
export type McpAppApprovalPrompt =
  | { kind: 'callTool'; server: string; tool: string; toolTitle?: string; argsPreview: string; rememberable: boolean }
  | { kind: 'sendMessage'; server: string; text: string; nonTextBlocks: number }

export type McpAppHostResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: McpAppsErrorData }
  | { ok: false; error: { code: 'approval_required'; challenge: string; prompt: McpAppApprovalPrompt; message?: string } }

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
  return await requestNativeAsync('mcpApp', { ...target, ...operation, ...(approval ? { approval } : {}) }, timeout) as McpAppHostResult<T>
}

class Declined extends Error {}

/** Send an operation; when the host asks for approval, confirm here and resend the identical one. */
export async function runMcpAppOperation<T>(target: McpAppTarget, operation: McpAppOperation, consent: McpAppConsent): Promise<T> {
  let result = await requestMcpApp<T>(target, operation)
  if (!result.ok && result.error.code === 'approval_required' && 'challenge' in result.error) {
    const decision = await consent.approve(result.error.prompt)
    if (!decision) throw new Declined()
    result = await requestMcpApp<T>(target, operation, { challenge: result.error.challenge, ...(decision.remember ? { remember: true } : {}) })
  }
  if (result.ok) return result.value
  const error = result.error as McpAppsErrorData
  throw new McpAppsError(error.code, error.message, error.challenge)
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
        if (!(error instanceof NativeRequestTimeout)) throw error
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
