import type { RefObject } from 'react'
import type { WebView } from 'react-native-webview'
import type { HostInbound, HostOutbound } from '@superone/chat-view'
import { isPreviewableMermaid } from '@superone/chat-view/mermaid-preview'
import type { SaveWidgetTemplateRequest } from '@superone/shared/agent-types'
import { isPreviewableImageSource, parseImageGenerationInfo, type ImagePreviewTarget } from './image-preview-state'
import type { TextFileResult } from './text-files'
import type { VideoPosterResult } from './video-posters'

type NativeRequest = Extract<HostOutbound, { type: 'requestNative' }>
type NativeResult = Extract<HostInbound, { type: 'nativeActionResult' }>

/** Impact strengths the transcript may ask for; mirrors expo-haptics' impact styles. */
export type HapticStyle = 'light' | 'medium' | 'heavy'
const HAPTIC_STYLES: ReadonlySet<string> = new Set<HapticStyle>(['light', 'medium', 'heavy'])

export interface NativeActionPorts {
  subscribeDetail?(detailRef: string, subscriptionId: string): Promise<Record<string, unknown>>
  unsubscribeDetail?(subscriptionId: string): Promise<void>
  loadNavigationIndex?(): Promise<import('@superone/shared/session-history-index').SessionHistoryIndex>
  loadHistoryWindow?(anchorId: string, direction: 'around' | 'before' | 'after'): Promise<Record<string, unknown>>
  loadEarlier?(): Promise<Record<string, unknown>>
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
   * or to `confirmRequired` when the relay would have to stage the file on R2
   * first; `confirmed` is that approval on the second request. Small relay
   * files skip confirmation and come back as a data URI in one trip.
   */
  loadImage(path: string, confirmed: boolean): Promise<Record<string, unknown>>
  /**
   * The first frame of a video on the host, for the transcript's video tile.
   * Cut on the host and always in-band, so there is no confirmation step;
   * `null` when the host cannot decode the clip and the tile stays a chip.
   */
  loadVideoPoster(path: string): Promise<VideoPosterResult | null>
  /**
   * A small text file, in-band, for the files previewer to render in place.
   * `tooLarge` when the host will not put it on the RPC; the card then shows
   * a chip that opens the preview page instead.
   */
  loadTextFile(path: string): Promise<TextFileResult>
  /**
   * The original picture behind a thumbnail the transcript carries for an
   * attachment (`ImageAttachment.preview`), as a data URI for the viewer.
   */
  loadAttachment(messageId: string, ref: { attachmentId?: string; name: string }): Promise<string>
  /**
   * The favicon the desktop's own chat shows in front of `url`, as a data URL.
   * `null` when it has none (or the host is too old to answer): the link keeps
   * its globe.
   */
  resolveFavicon(url: string, isDark: boolean): Promise<string | null>
  /**
   * Show a picture the transcript is already displaying on the fullscreen
   * viewer. `src` is the data URI or public URL the `<img>` was painted from,
   * so no second transfer happens; `path` is the desktop path when there is one;
   * `generation` is what the info panel shows for a generated image.
   */
  previewImage(target: ImagePreviewTarget): Promise<void>
  /**
   * Show a mermaid diagram the transcript already rendered, on a page of its
   * own. `svg` is the markup mermaid.render produced in the chat WebView.
   */
  previewMermaid(svg: string): Promise<void>
  copyText(text: string): Promise<void>
  /**
   * Play a Taptic impact. The WebView cannot reach the haptic engine, so a
   * gesture it recognises (a long press on a bubble) asks the shell to confirm it.
   */
  haptic(style: HapticStyle): Promise<void>
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
    if (message.action === 'subscribeDetail') {
      if (!ports.subscribeDetail) throw new Error('Details unavailable')
      result = await ports.subscribeDetail(payloadString(message, 'detailRef'), payloadString(message, 'subscriptionId'))
    } else if (message.action === 'unsubscribeDetail') {
      await ports.unsubscribeDetail?.(payloadString(message, 'subscriptionId'))
    } else if (message.action === 'loadNavigationIndex') {
      if (!ports.loadNavigationIndex) throw new Error('Navigation unavailable')
      result = { ...await ports.loadNavigationIndex() }
    } else if (message.action === 'loadHistoryWindow') {
      if (!ports.loadHistoryWindow) throw new Error('History unavailable')
      const direction = payloadString(message, 'direction')
      if (direction !== 'around' && direction !== 'before' && direction !== 'after') throw new Error('Invalid history direction')
      result = await ports.loadHistoryWindow(payloadString(message, 'anchorId'), direction)
    } else if (message.action === 'loadEarlier') {
      if (!ports.loadEarlier) throw new Error('History is unavailable')
      result = await ports.loadEarlier()
    } else if (message.action === 'openLink') {
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
    } else if (message.action === 'loadVideoPoster') {
      result = { poster: await ports.loadVideoPoster(payloadString(message, 'path')) }
    } else if (message.action === 'loadTextFile') {
      result = await ports.loadTextFile(payloadString(message, 'path'))
    } else if (message.action === 'loadAttachment') {
      const attachmentId = (message.payload as Record<string, unknown> | undefined)?.attachmentId
      result = { dataUri: await ports.loadAttachment(payloadString(message, 'messageId'), {
        ...(typeof attachmentId === 'string' ? { attachmentId } : {}),
        name: payloadString(message, 'name'),
      }) }
    } else if (message.action === 'resolveFavicon') {
      const url = payloadString(message, 'url')
      if (!/^https?:\/\//i.test(url)) throw new Error('unsupported link')
      const isDark = (message.payload as Record<string, unknown> | undefined)?.isDark === true
      result = { dataUrl: await ports.resolveFavicon(url, isDark) }
    } else if (message.action === 'previewImage') {
      const src = payloadString(message, 'src')
      if (!isPreviewableImageSource(src)) throw new Error('unsupported image source')
      const payload = (message.payload ?? {}) as Record<string, unknown>
      const generation = parseImageGenerationInfo(payload.generation)
      await ports.previewImage({
        src,
        ...(typeof payload.label === 'string' && payload.label ? { label: payload.label } : {}),
        ...(typeof payload.path === 'string' && payload.path ? { path: payload.path } : {}),
        ...(generation ? { generation } : {}),
      })
    } else if (message.action === 'previewMermaid') {
      const svg = payloadString(message, 'svg')
      if (!isPreviewableMermaid(svg)) throw new Error('unsupported mermaid diagram')
      await ports.previewMermaid(svg)
    } else if (message.action === 'copyText') {
      await ports.copyText(payloadString(message, 'text'))
    } else if (message.action === 'haptic') {
      const style = (message.payload as Record<string, unknown> | undefined)?.style
      // An unknown strength still ticks: feedback is better than a silent gesture.
      await ports.haptic(typeof style === 'string' && HAPTIC_STYLES.has(style) ? style as HapticStyle : 'medium')
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
