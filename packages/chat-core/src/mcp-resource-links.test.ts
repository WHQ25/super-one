import { describe, expect, it } from 'vitest'
import { applyEventToSession } from './reducer'
import { createDefaultChatCoreSession } from './defaults'

const report = { uri: 'file:///tmp/q4.pdf', name: 'q4.pdf' }

describe('MCP resource links', () => {
  it('lands a backgrounded call\'s returned files on its placeholder result', () => {
    const session = createDefaultChatCoreSession()
    session.messages = [{
      id: 'a1', role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude',
      content: [
        { type: 'tool_use', toolUseId: 'mcp-1', toolName: 'mcp__reports__export', input: '{}', status: 'complete' },
        { type: 'tool_result', toolUseId: 'mcp-1', summary: 'Running in the background' },
        { type: 'tool_result', toolUseId: 'other', summary: 'untouched' },
      ],
    }]
    Object.assign(session, applyEventToSession(session, {
      type: 'task_notification',
      taskId: 't1',
      toolUseId: 'mcp-1',
      taskStatus: 'completed',
      outputFile: '',
      resourceLinks: [report],
    }))
    const [, result, other] = session.messages[0]!.content
    expect(result).toMatchObject({ toolUseId: 'mcp-1', resourceLinks: [report] })
    expect(other).not.toHaveProperty('resourceLinks')
  })
})
