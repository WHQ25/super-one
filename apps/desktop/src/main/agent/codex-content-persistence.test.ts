import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatMessage, CodexThreadItem } from '@superone/shared/agent-types'
import { createCodexContentStream } from '@superone/shared/codex-content'
import { applyCodexEventToRuntime, finalizeCodexAssistantMessage, type CodexSessionRuntime } from './codex-session-runtime'

function runtimeWith(items: CodexThreadItem[] = []): CodexSessionRuntime {
  const message: ChatMessage = { id: 'm', role: 'assistant', providerId: 'codex', status: 'streaming', content: [], createdAt: '',
    metadata: { codex: { threadId: 'thread', usage: null, items } } }
  return { projectPath: '/project', sessionId: 's', messages: [message], totalCostUsd: 0, contextTokens: 0, gitBranch: null,
    worktreePath: null, streamingTokensByMessageId: {}, lastUsageByMessageId: {} }
}

/** Persist the content deltas a producer sends for these item snapshots. */
function persist(runtime: CodexSessionRuntime, ...items: CodexThreadItem[]): CodexSessionRuntime {
  const stream = createCodexContentStream()
  return items.flatMap(item => stream.update(item)).reduce((current, { delta, replace }) => applyCodexEventToRuntime(current,
    { type: 'content_delta', messageId: 'm', delta, ...(replace ? { replace } : {}) } satisfies AgentEvent), runtime)
}

const running: CodexThreadItem = { id: 'cmd', type: 'command_execution', command: 'bun test', aggregatedOutput: 'ok', status: 'in_progress' }
const reply: CodexThreadItem = { id: 'a', type: 'agent_message', text: 'Done' }

describe('persisting a content-shaped Codex turn', () => {
  it('stores its streamed content and keeps it at completion', () => {
    const streamed = persist(runtimeWith(), running, reply)
    expect(streamed.messages[0]!.content.map(block => block.type)).toEqual(['tool_use', 'text'])
    const done = finalizeCodexAssistantMessage(streamed, { messageId: 'm', status: 'complete', text: 'Done',
      result: { threadId: 'thread', finalResponse: 'Done', items: [], usage: null } })
    expect(done.messages[0]!.content).toMatchObject([{ toolName: 'Bash', status: 'complete' }, { type: 'text', text: 'Done' }])
  })

  it('keeps its content when interrupted, with the running tool sealed', () => {
    const stopped = finalizeCodexAssistantMessage(persist(runtimeWith(), running), { messageId: 'm', status: 'interrupted', text: 'Codex run interrupted.' })
    expect(stopped.messages[0]!.content).toMatchObject([{ toolName: 'Bash', status: 'complete' }])
  })

  it('still stores a legacy turn reply as text', () => {
    const done = finalizeCodexAssistantMessage(runtimeWith([reply]), { messageId: 'm', status: 'complete', text: 'Done',
      result: { threadId: 'thread', finalResponse: 'Done', items: [reply], usage: null } })
    expect(done.messages[0]!.content).toEqual([{ type: 'text', text: 'Done' }])
  })
})
