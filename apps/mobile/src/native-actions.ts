import type { RefObject } from 'react'
import type { WebView } from 'react-native-webview'
import type { HostInbound, HostOutbound } from '@superone/chat-view'
import type { SaveWidgetTemplateRequest } from '@superone/shared/agent-types'

type NativeRequest = Extract<HostOutbound, { type: 'requestNative' }>
type NativeResult = Extract<HostInbound, { type: 'nativeActionResult' }>

export interface NativeActionPorts {
  openLink(url: string): Promise<void>
  /** Reveal the file's folder in the native browser — the chip's secondary action. */
  openFile(path: string): Promise<void>
  /**
   * Show the file itself: small text in the preview page, anything else through
   * the receive/share sheet. `line` is the cited line a chip was tapped on.
   */
  previewFile(path: string, line?: number): Promise<void>
  /**
   * Fetch an image for the transcript to show inline. Resolves to the data URI,
   * or to `confirmRequired` when the transport wants the user to approve the
   * transfer first; `confirmed` is that approval on the second request.
   */
  loadImage(path: string, confirmed: boolean): Promise<Record<string, unknown>>
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
    // Most actions only acknowledge; the few that answer merge their fields in.
    let result: Record<string, unknown> = {}
    if (message.action === 'openLink') {
      const url = payloadString(message, 'url')
      if (!/^https?:\/\//i.test(url)) throw new Error('unsupported link')
      await ports.openLink(url)
    } else if (message.action === 'openFile' || message.action === 'showInFolder') {
      await ports.openFile(payloadString(message, 'path'))
    } else if (message.action === 'previewFile') {
      const line = (message.payload as Record<string, unknown> | undefined)?.line
      // A malformed line is dropped, not fatal: the file still opens, just unanchored.
      await ports.previewFile(
        payloadString(message, 'path'),
        typeof line === 'number' && Number.isInteger(line) && line > 0 ? line : undefined,
      )
    } else if (message.action === 'loadImage') {
      const confirmed = (message.payload as Record<string, unknown> | undefined)?.confirmed === true
      result = await ports.loadImage(payloadString(message, 'path'), confirmed)
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
    return { type: 'nativeActionResult', requestId: message.requestId, result: { ok: true, ...result } }
  } catch (error) {
    return {
      type: 'nativeActionResult',
      requestId: message.requestId,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
