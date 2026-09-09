import type { RefObject } from 'react'
import type { WebView } from 'react-native-webview'
import type { HostInbound, HostOutbound } from '@superone/chat-view'
import type { SaveWidgetTemplateRequest } from '@superone/shared/agent-types'

type NativeRequest = Extract<HostOutbound, { type: 'requestNative' }>
type NativeResult = Extract<HostInbound, { type: 'nativeActionResult' }>

export interface NativeActionPorts {
  openLink(url: string): Promise<void>
  openFile(path: string): Promise<void>
  previewFile(path: string): Promise<void>
  copyText(text: string): Promise<void>
  /**
   * Write text into the composer without sending it. This is a widget's
   * `sendPrompt(...)`, which on the desktop fills the draft rather than
   * submitting — the user still gets to edit or discard it.
   */
  setDraft(text: string): Promise<void>
  /**
   * Persist a widget as a reusable template. The store is the desktop's disk, so this
   * crosses the relay rather than writing anything on the phone.
   */
  saveWidgetTemplate(input: SaveWidgetTemplateRequest): Promise<void>
  codexAsyncQuestionAnswer(messageId: string, itemId: string, answers: string[]): Promise<void>
  codexPlanApproval(messageId: string, status: 'approved' | 'rejected', feedback?: string): Promise<void>
}

function payloadString(message: NativeRequest, key: string): string {
  const value = (message.payload as Record<string, unknown> | undefined)?.[key]
  if (typeof value !== 'string' || !value) throw new Error(`invalid ${message.action} payload`)
  return value
}

/**
 * The template store rejects an unknown scope and a blank id, so both are checked here
 * rather than sent across the relay to fail on the far side, where the phone would see
 * a generic host error instead of the field it got wrong.
 */
function parseSaveWidgetTemplate(message: NativeRequest): SaveWidgetTemplateRequest {
  const payload = (message.payload ?? {}) as Record<string, unknown>
  const scope = payload.scope
  if (scope !== 'project' && scope !== 'user') throw new Error('invalid saveWidgetTemplate scope')
  return {
    id: payloadString(message, 'id'),
    title: payloadString(message, 'title'),
    code: payloadString(message, 'code'),
    scope,
    ...(typeof payload.description === 'string' && payload.description ? { description: payload.description } : {}),
    ...(payload.inputSchema && typeof payload.inputSchema === 'object' && !Array.isArray(payload.inputSchema)
      ? { inputSchema: payload.inputSchema as Record<string, unknown> }
      : {}),
  }
}

export function injectHostMessage(ref: RefObject<WebView | null>, message: unknown): void {
  ref.current?.injectJavaScript(`globalThis.__applyHost(${JSON.stringify(message)});true;`)
}

export async function resolveNativeRequest(
  message: NativeRequest,
  ports: NativeActionPorts,
): Promise<NativeResult> {
  try {
    if (message.action === 'openLink') {
      const url = payloadString(message, 'url')
      if (!/^https?:\/\//i.test(url)) throw new Error('unsupported link')
      await ports.openLink(url)
    } else if (message.action === 'openFile' || message.action === 'showInFolder') {
      await ports.openFile(payloadString(message, 'path'))
    } else if (message.action === 'previewFile') {
      await ports.previewFile(payloadString(message, 'path'))
    } else if (message.action === 'copyText') {
      await ports.copyText(payloadString(message, 'text'))
    } else if (message.action === 'setDraft') {
      await ports.setDraft(payloadString(message, 'text'))
    } else if (message.action === 'saveWidgetTemplate') {
      await ports.saveWidgetTemplate(parseSaveWidgetTemplate(message))
    } else if (message.action === 'codexAsyncQuestionAnswer') {
      const answers = (message.payload as Record<string, unknown> | undefined)?.answers
      if (!Array.isArray(answers) || !answers.length || answers.some(answer => typeof answer !== 'string' || !answer.trim())) {
        throw new Error('invalid codexAsyncQuestionAnswer answers')
      }
      await ports.codexAsyncQuestionAnswer(payloadString(message, 'messageId'), payloadString(message, 'itemId'), answers)
    } else if (message.action === 'codexPlanApproval') {
      const status = payloadString(message, 'status')
      if (status !== 'approved' && status !== 'rejected') throw new Error('invalid codexPlanApproval status')
      const feedbackValue = (message.payload as Record<string, unknown> | undefined)?.feedback
      if (feedbackValue !== undefined && typeof feedbackValue !== 'string') {
        throw new Error('invalid codexPlanApproval feedback')
      }
      await ports.codexPlanApproval(
        payloadString(message, 'messageId'),
        status,
        feedbackValue,
      )
    } else {
      throw new Error(`${message.action} is not available on mobile`)
    }
    return { type: 'nativeActionResult', requestId: message.requestId, result: { ok: true } }
  } catch (error) {
    return {
      type: 'nativeActionResult',
      requestId: message.requestId,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
