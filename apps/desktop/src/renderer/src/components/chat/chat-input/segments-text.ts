import type { InputSegment } from '@/stores/chat-store/types'

type TextSegment = Extract<InputSegment, { text: string }>

/** A one-line paste reads as part of the sentence it sits in. */
const isInlinePaste = (segment: TextSegment): boolean => segment.isPaste && !segment.text.includes('\n')

/**
 * The text the agent gets for the composer's segments. Each segment starts its
 * own line, except a one-line paste, which joins the words around it.
 */
export function segmentsText(segments: InputSegment[]): string {
  const texts = segments.filter((segment): segment is TextSegment => 'text' in segment)
  return texts.map((segment, index) => {
    if (index === 0) return segment.text
    return (isInlinePaste(segment) || isInlinePaste(texts[index - 1]!) ? ' ' : '\n') + segment.text
  }).join('')
}
