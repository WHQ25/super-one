/** @vitest-environment jsdom */
/**
 * Recording-driven regression for sub-agent grouping in a real deep-research run
 * (recording: scripts/recordings → fixtures/recordings/nested-subagent-render.emit.json).
 *
 * The top-level "general-purpose" agent (toolUseId …KD9DskoK) runs in the
 * background, so the SDK returns its Task tool_result EARLY ("started…") and only
 * then streams the agent's real children (Skill, ToolSearch, 5 nested Agents).
 * groupContent must keep the collector open after the result; otherwise every
 * later child fails topAncestorSubagent and leaks into the main conversation.
 */
import { describe, it, expect } from 'vitest'
import type { AgentEvent, ContentBlock } from '@superone/shared/agent-types'
import { applyContentDelta } from '@superone/shared/content-delta'
import { groupContent } from '../../renderer/src/components/chat/ChatMessage'
import rawFixture from '../fixtures/recordings/nested-subagent-render.emit.json'

const events = rawFixture as unknown as AgentEvent[]

function rebuildMessages(): ContentBlock[][] {
  const byMsg = new Map<string, ContentBlock[]>()
  for (const e of events) {
    if (e.type !== 'content_delta') continue
    const ev = e as unknown as { messageId: string; delta: ContentBlock }
    byMsg.set(ev.messageId, applyContentDelta(byMsg.get(ev.messageId) ?? [], ev.delta))
  }
  return [...byMsg.values()]
}

function parentOf(b: ContentBlock): string | null {
  return 'parentToolUseId' in b ? b.parentToolUseId ?? null : null
}

// Blocks that a render segment surfaces directly at the top level of the message.
function topLevelBlocks(seg: Record<string, unknown>): ContentBlock[] {
  switch (seg.kind) {
    case 'block': return [seg.block as ContentBlock]
    case 'tools': case 'thinking': case 'app-tools': return seg.blocks as ContentBlock[]
    default: return [] // subagent / workflow are containers — their children are nested, not top-level
  }
}

describe('nested sub-agent grouping (recording: nested-subagent-render)', () => {
  it('never surfaces a sub-agent-owned block at the top level of the conversation', () => {
    for (const content of rebuildMessages()) {
      const { segments } = groupContent(content, [])
      const leaked = segments
        .flatMap((s) => topLevelBlocks(s as unknown as Record<string, unknown>))
        .filter((b) => parentOf(b) !== null)
      expect(leaked.map((b) => `${(b as { toolName?: string }).toolName ?? b.type}:${parentOf(b)}`)).toEqual([])
    }
  })

  it('collects the background agent\'s children (incl. nested agents) under its segment', () => {
    const content = rebuildMessages().find((c) =>
      c.some((b) => b.type === 'tool_use' && b.toolName === 'Agent' && parentOf(b) === null),
    )!
    const { segments } = groupContent(content, [])
    const top = segments.find((s) => s.kind === 'subagent') as { childBlocks: ContentBlock[] } | undefined
    expect(top).toBeDefined()
    // Its own tools + the five nested Agent calls all land in its flat subtree.
    expect(top!.childBlocks.length).toBeGreaterThan(5)
    const nestedAgents = top!.childBlocks.filter((b) => b.type === 'tool_use' && b.toolName === 'Agent')
    expect(nestedAgents.length).toBe(5)
  })
})
