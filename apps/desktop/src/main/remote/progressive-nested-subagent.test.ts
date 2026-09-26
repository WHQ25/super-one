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

  it('marks a backgrounded agent so its launch receipt does not read as the run finishing', () => {
    const content = phoneAfter({ type: 'task_started', taskId: 'a0', toolUseId: 'parent', description: 'parent', taskType: 'local_agent', isBackgrounded: true })
    expect(content[0]).toMatchObject({ toolUseId: 'parent', runInBackground: true })
  })

  it('carries the background mark in the shell a reconnecting phone receives', () => {
    const source = desktopMessage()
    source.content[0] = { ...source.content[0]!, runInBackground: true } as ChatMessage['content'][number]
    expect(projectProgressiveMessage(source).content[0]).toMatchObject({ toolUseId: 'parent', runInBackground: true })
  })

  it('reopens a finished agent on the phone when a resume registers it again', () => {
    const source = desktopMessage()
    source.content[0] = { ...source.content[0]!, taskStatus: 'completed', taskResultText: 'first run' } as ChatMessage['content'][number]
    source.content.push({ type: 'tool_use', toolName: 'SendMessage', toolUseId: 'send-message', input: '{}', status: 'complete' })
    const session = createDefaultChatCoreSession()
    session.messages = [projectProgressiveMessage(source)]
    Object.assign(session, applyEventToSession(session, { type: 'task_started', taskId: 'a0', toolUseId: 'parent', description: 'parent', taskType: 'local_agent' }))
    Object.assign(session, applyEventToSession(session, { type: 'task_notification', taskId: 'a0', toolUseId: 'parent', taskStatus: 'completed', outputFile: '' }))
    // The resume names the waker's tool call; the task id leads back to the card.
    const resume = projectProgressiveEvent({ type: 'task_started', taskId: 'a0', toolUseId: 'send-message', description: 'parent', taskType: 'local_agent', isBackgrounded: true }, [source])
    Object.assign(session, applyEventToSession(session, resume!))
    expect(session.messages[0]!.content[0]).not.toHaveProperty('taskStatus')
    expect(session.taskProgress.parent?.completed).toBe(false)
    expect(session.messages[0]!.content.filter(block => block.type === 'tool_use').map(block => 'toolUseId' in block && block.toolUseId)).toEqual(['parent', 'send-message'])
  })

  it('still synthesizes a card for a task whose launch block the desktop never had', () => {
    const content = phoneAfter({ type: 'task_started', taskId: 'slash', toolUseId: 'slash-tool', description: 'review', taskType: 'local_agent' })
    expect(content.some(block => block.type === 'tool_use' && block.toolUseId === 'slash-tool')).toBe(true)
  })
})
