import type { ComponentType, ReactNode } from 'react'

export interface TurnSegmentProps {
  children: ReactNode
  estimate?: number
  id: string
}

/** Share bounded activity chunks across both ContentBlock and Codex turns. */
export function renderTurnSegments<T>(
  segments: readonly T[],
  contents: ReactNode[],
  Segment: ComponentType<TurnSegmentProps> | undefined,
  describe: (segment: T) => { id: string; estimate: number },
): ReactNode[] {
  if (!Segment) return contents
  // Keep observer/state overhead bounded as well as the mounted activity DOM.
  const chunks: ReactNode[] = []
  for (let start = 0; start < segments.length; start += 8) {
    const chunk = segments.slice(start, start + 8).map(describe)
    chunks.push(<Segment key={chunk[0].id} id={chunk[0].id} estimate={chunk.reduce((height, item) => height + item.estimate, 0)}>
      {contents.slice(start, start + 8)}
    </Segment>)
  }
  return chunks
}
