import type { CodexThreadItem, CodexTurnInfo } from '@superone/shared/agent-types'
import { applyCodexSubagentActivity, collectCodexCollabMetadata, mergeCodexTurnProvenance,
  type CodexRequestedTurnProvenance, type CodexSubagentActivity, type CodexSubagentMetadata, type CodexTurnProvenance } from '@superone/shared/codex-metadata'

export interface CodexMessageSegment {
  order: string[]
  map: Map<string, CodexThreadItem>
  metadata?: {
    provenance?: CodexTurnProvenance
    requestedProvenance?: CodexRequestedTurnProvenance
    subagents?: Record<string, CodexSubagentMetadata>
  }
}

export function recordCodexSegmentProvenance(segment: CodexMessageSegment, next: CodexTurnProvenance, requested?: CodexRequestedTurnProvenance): void {
  const previous = segment.metadata
  const provenance = mergeCodexTurnProvenance(previous?.provenance, next)
  const sameTurn = previous?.provenance?.threadId === next.threadId && previous.provenance.turnId === next.turnId
  segment.metadata = { subagents: previous?.subagents, provenance,
    requestedProvenance: requested ?? (sameTurn ? previous?.requestedProvenance : undefined) }
}

export function recordCodexSegmentActivity(segment: CodexMessageSegment, activity: CodexSubagentActivity): void {
  segment.metadata = { ...segment.metadata, subagents: applyCodexSubagentActivity(segment.metadata?.subagents, activity) }
}

export function codexSegmentCompletionData(segment: CodexMessageSegment | undefined, items: CodexThreadItem[]): Pick<CodexTurnInfo, 'rootTurnId' | 'requestedProvenance' | 'subagents'> {
  const metadata = segment?.metadata
  const subagents = collectCodexCollabMetadata(items, metadata?.subagents)
  return {
    ...(metadata?.provenance?.rootTurnId !== undefined ? { rootTurnId: metadata.provenance.rootTurnId } : {}),
    ...(metadata?.requestedProvenance ? { requestedProvenance: metadata.requestedProvenance } : {}),
    ...(subagents ? { subagents } : {}),
  }
}
