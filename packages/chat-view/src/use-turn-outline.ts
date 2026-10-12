import { useMemo, useRef } from 'react'
import type { ChatMessage } from '@superone/shared/agent-types'
import { extractTurnOutline, type TurnOutlineEntry } from '@superone/shared/turn-outline'
import type { TranscriptSegment } from '@superone/shared/transcript-segments'

/** Reveal new segments live, without rebuilding the rail on unchanged text deltas. */
export function useTurnOutline(messages: readonly ChatMessage[], segments: readonly TranscriptSegment[], indexed?: TurnOutlineEntry[]): TurnOutlineEntry[] {
  const previous = useRef<TurnOutlineEntry[]>([])
  return useMemo(() => {
    const next = indexed ?? extractTurnOutline(messages, segments)
    if (next.length === previous.current.length && next.every((entry, index) => {
      const old = previous.current[index]
      return entry.id === old.id && entry.index === old.index && entry.text === old.text && entry.reply === old.reply
        && entry.messageId === old.messageId && entry.messageIndex === old.messageIndex && entry.createdAt === old.createdAt
        && entry.anchorId === old.anchorId && entry.offset === old.offset
    })) return previous.current
    previous.current = next
    return next
  }, [messages, segments, indexed])
}
