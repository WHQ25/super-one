import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'

vi.mock('./remote-highlighter', () => ({ initHighlighter: vi.fn(), highlightCodeSync: vi.fn(() => null), highlightCodeByLang: vi.fn(() => null), parseAnsiTokens: vi.fn(() => []) }))
vi.mock('./logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
vi.mock('./agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('./agent/claude-session-runtime', () => ({ readOutputFile: vi.fn() }))
import { RemoteControlService } from './remote-control-service'

function fixture() {
  const service = new RemoteControlService('wss://relay.example', { onCommand: vi.fn() })
  const send = vi.fn()
  Object.assign(service, { keys: { aesKey: {} }, hasAnyMobileTransport: () => true, queueSend: send })
  return { service, send }
}

describe('remote live text and reasoning', () => {
  it.each(['text', 'thinking'] as const)('forwards each %s delta immediately with metadata and routing intact', async (type) => {
    const { service, send } = fixture()
    // Whitespace-only chunks and split Markdown markers must survive verbatim.
    for (const [index, text] of ['Hello', ' ', '\n\n', '```', 'ts\n', 'const x = 1', '\n```'].entries()) {
      const event: AgentEvent = {
        type: 'content_delta', messageId: `m-${index % 2}`, sessionId: `s-${index % 2}`,
        projectPath: '/project', seq: index + 1, epoch: 3,
        delta: type === 'text' ? { type, text, parentToolUseId: 'child' }
          : { type, thinking: text, parentToolUseId: 'child', startedAt: 100, endedAt: 200 },
      }
      const targets = [`phone-${index % 2}`]
      await service.sendAgentEvent(event, targets)
      expect(send).toHaveBeenCalledTimes(index + 1)
      expect(send).toHaveBeenLastCalledWith([event], targets)
    }
  })

  it('keeps thinking, tool start, result and answer in arrival order without synthetic events', async () => {
    const { service, send } = fixture()
    const events: AgentEvent[] = [
      { type: 'content_delta', messageId: 'm', delta: { type: 'thinking', thinking: 'Check' } },
      { type: 'content_delta', messageId: 'm', delta: { type: 'tool_use', toolUseId: 't', toolName: 'Read', input: '{"file_path":"README.md"}' } },
      { type: 'content_delta', messageId: 'm', delta: { type: 'tool_result', toolUseId: 't', summary: 'Done' } },
      { type: 'content_delta', messageId: 'm', delta: { type: 'text', text: 'Answer' } },
    ]
    for (const event of events) await service.sendAgentEvent(event, ['phone'])
    expect(send.mock.calls.map(([batch]) => batch[0].delta.type)).toEqual(['thinking', 'read', 'tool_result', 'text'])
  })

  it('continues filtering tool input deltas', async () => {
    const { service, send } = fixture()
    await service.sendAgentEvent({ type: 'tool_input_delta', messageId: 'm', toolUseId: 't', partialJson: 'x'.repeat(10_000) })
    expect(send).not.toHaveBeenCalled()
  })
})
