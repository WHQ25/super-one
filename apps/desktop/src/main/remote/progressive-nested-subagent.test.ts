import { describe, expect, it, vi } from 'vitest'
vi.mock('../remote-content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../remote-content')>()
  return { ...actual, stripMessagesForRemote: (messages: unknown) => messages }
})
import { applyEventToSession, createDefaultChatCoreSession } from '@superone/chat-core'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import { projectProgressiveEvent, projectProgressiveMessage } from './progressive-session'

const agent = (toolUseId: string, parentToolUseId?: string) => ({
  type: 'tool_use' as const,
  toolName: 'Agent',
  toolUseId,
  input: JSON.stringify({ description: toolUseId, run_in_background: !parentToolUseId }),
  status: 'complete' as const,
  ...(parentToolUseId ? { parentToolUseId } : {}),
})

// The desktop transcript: a background agent that launched a nested agent of its own.
const desktopMessage = (): ChatMessage => ({ id: 'm', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'claude', content: [
  agent('parent'),
  { type: 'tool_result', toolUseId: 'parent', summary: 'Async agent launched successfully.' },
  agent('nested', 'parent'),
] })

function phoneAfter(event: AgentEvent) {
  const source = desktopMessage()
  const session = createDefaultChatCoreSession()
  session.messages = [projectProgressiveMessage(source)]
  const projected = projectProgressiveEvent(event, [source])
  if (projected) Object.assign(session, applyEventToSession(session, projected))
  return session.messages[0]!.content
}

describe('progressive projection of a nested subagent', () => {
  it('keeps a nested agent behind its parent card when its task starts', () => {
    const content = phoneAfter({ type: 'task_started', taskId: 'a1', toolUseId: 'nested', description: 'nested', taskType: 'local_agent' })
    expect(content.flatMap(block => 'toolUseId' in block && block.type === 'tool_use' ? [block.toolUseId] : [])).toEqual(['parent'])
  })

  it('still synthesizes a card for a task whose launch block the desktop never had', () => {
    const content = phoneAfter({ type: 'task_started', taskId: 'slash', toolUseId: 'slash-tool', description: 'review', taskType: 'local_agent' })
    expect(content.some(block => block.type === 'tool_use' && block.toolUseId === 'slash-tool')).toBe(true)
  })
})
