/** Read-aloud stops here so a long reply cannot turn into an unbounded synthesis call. */
export const SPOKEN_TEXT_LIMIT = 4500

/**
 * Non-streaming models (Gemini, OpenAI) return one audio file per call.
 * Pack the reply into pieces about this long so playback can start on the first piece.
 */
export const SPOKEN_SEGMENT_CHARS = 400

export interface SpokenText {
  text: string
  truncated: boolean
}

/**
 * Turn a chat reply into something a speech model can say.
 * Code fences are dropped; links keep their label.
 */
export function spokenText(raw: string): SpokenText {
  const text = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= SPOKEN_TEXT_LIMIT) return { text, truncated: false }
  return { text: text.slice(0, SPOKEN_TEXT_LIMIT).trim(), truncated: true }
}

/** Sentence-sized pieces for providers that cannot stream audio. */
export function spokenSegments(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= SPOKEN_SEGMENT_CHARS) return [trimmed]
  const parts = trimmed.split(/(?<=[.!?。！？])\s+/)
  const segments: string[] = []
  let current = ''
  const push = (piece: string) => {
    if (piece) segments.push(piece)
  }
  for (const part of parts) {
    if (part.length > SPOKEN_SEGMENT_CHARS) {
      push(current)
      current = ''
      for (let index = 0; index < part.length; index += SPOKEN_SEGMENT_CHARS) {
        push(part.slice(index, index + SPOKEN_SEGMENT_CHARS).trim())
      }
      continue
    }
    const next = current ? `${current} ${part}` : part
    if (current && next.length > SPOKEN_SEGMENT_CHARS) {
      push(current)
      current = part
    } else {
      current = next
    }
  }
  push(current)
  return segments
}
