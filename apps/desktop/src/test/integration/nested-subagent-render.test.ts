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
import { collectBackgroundActivities } from '../../renderer/src/components/chat/ChatStatusBar'
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

// Replay every event up to (and including) `stopIndex`, reconstructing the
// status-bar inputs at that moment: per-message content, taskProgress, and
// whether the main turn is streaming.
function rebuildStatusBarStateAt(stopIndex: number): {
  messages: { content: ContentBlock[] }[]
  taskProgress: Record<string, { description: string; completed?: boolean }>
  streaming: boolean
} {
  const byMsg = new Map<string, ContentBlock[]>()
  const taskProgress: Record<string, { description: string; completed?: boolean }> = {}
  let streaming = false
  for (let i = 0; i <= stopIndex; i++) {
    const e = events[i]
    if (e.type === 'content_delta') {
      const ev = e as unknown as { messageId: string; delta: ContentBlock }
      byMsg.set(ev.messageId, applyContentDelta(byMsg.get(ev.messageId) ?? [], ev.delta))
    } else if (e.type === 'status_change') {
      streaming = (e as unknown as { status: string }).status === 'streaming'
    } else if (e.type === 'task_started') {
      const ev = e as unknown as { toolUseId: string; description: string }
      if (ev.toolUseId) taskProgress[ev.toolUseId] = { description: ev.description, completed: false }
    } else if (e.type === 'task_notification') {
      const ev = e as unknown as { toolUseId: string }
      if (ev.toolUseId && taskProgress[ev.toolUseId]) taskProgress[ev.toolUseId].completed = true
    }
  }
  return { messages: [...byMsg.values()].map((content) => ({ content })), taskProgress, streaming }
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

  it('surfaces the background agent and all running nested agents in the status-bar panel', () => {
    // Find the first event after which all six sub-agents are tracked-and-running.
    const peakIndex = events.findIndex((_, i) => {
      const { taskProgress } = rebuildStatusBarStateAt(i)
      return Object.values(taskProgress).filter((p) => !p.completed).length === 6
    })
    expect(peakIndex).toBeGreaterThan(-1)

    const { messages, taskProgress, streaming } = rebuildStatusBarStateAt(peakIndex)
    // The top-level agent runs in the background, so the main turn is idle here —
    // the exact condition the old run_in_background/isStreaming heuristic missed.
    expect(streaming).toBe(false)
    const { agentActivities } = collectBackgroundActivities(messages, taskProgress as never, streaming)
    expect(agentActivities.length).toBe(6)
  })
})
