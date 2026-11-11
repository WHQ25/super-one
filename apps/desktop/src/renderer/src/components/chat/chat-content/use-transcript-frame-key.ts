import { useState } from 'react'

export function useTranscriptFrameKey(
  displayedSessionId: string | null | undefined,
  isEmptyLanding: boolean,
): string {
  const normalizedId = displayedSessionId ?? 'default'
  const [frame, setFrame] = useState({
    sessionId: normalizedId,
    wasEmptyLanding: isEmptyLanding,
    generation: 0,
  })
  if (frame.sessionId !== normalizedId) {
    const nextGen = frame.wasEmptyLanding && isEmptyLanding
      ? frame.generation
      : frame.generation + 1
    setFrame({
      sessionId: normalizedId,
      wasEmptyLanding: isEmptyLanding,
      generation: nextGen,
    })
    return `transcript:${nextGen}`
  }
  if (frame.wasEmptyLanding !== isEmptyLanding) {
    setFrame({
      sessionId: normalizedId,
      wasEmptyLanding: isEmptyLanding,
      generation: frame.generation,
    })
  }
  return `transcript:${frame.generation}`
}
