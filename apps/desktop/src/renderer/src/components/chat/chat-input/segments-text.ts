import type { InputSegment } from '@/stores/chat-store/types'
import { joinComposerTextSegments } from '@superone/shared/user-message-parts'

type TextSegment = Extract<InputSegment, { text: string }>

/**
 * The text the agent gets for the composer's segments. Each segment starts its
 * own line, except a one-line paste, which joins the words around it.
 */
export function segmentsText(segments: InputSegment[]): string {
  const texts = segments.filter((segment): segment is TextSegment => 'text' in segment)
  return joinComposerTextSegments(texts)
}
