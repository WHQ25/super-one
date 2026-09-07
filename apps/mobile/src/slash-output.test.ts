import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { ChatRuntime } from './runtime'

/**
 * A slash command's output, from the message the user sent to what the phone
 * shows.
 *
 * The wire messages that report it carry no command name — only the input the
 * user sent does — so the association is made at send time. Without it the
 * transcript reads `Command / executed.` and `/compact` leaves its own prompt
 * behind, which is why the host used to drop the event instead of sending it.
 */
function runtime() {
  const client = {
    startBuffering() {},
    releaseBuffer() { return { epoch: 1, batches: [] } },
    send: vi.fn(),
    request: vi.fn(async () => ({ ok: true })),
  }
  const instance = new ChatRuntime(client as never, () => {})
  return { instance, client }
}

const outputEvent = (messageId: string, content: string): AgentEvent =>
  ({ type: 'slash_command_output', messageId, content }) as AgentEvent

const message = (id: string, role: 'user' | 'assistant', text: string): AgentEvent[] => [
  { type: 'message_start', message: { id, role, content: [], status: 'streaming', createdAt: new Date(0).toISOString() } } as AgentEvent,
  { type: 'content_delta', messageId: id, delta: { type: 'text', text } } as AgentEvent,
  { type: 'message_complete', messageId: id } as AgentEvent,
]
const assistant = (id: string, text: string) => message(id, 'assistant', text)

describe('slash command output', () => {
  it('renders a report as the answer it is', () => {
    const { instance } = runtime()
    instance.send('/code-review look at the diff')
    instance.ingest(assistant('m1', 'Command output follows'))
    instance.ingest([outputEvent('m1', '## Findings\n\nOne real bug.')])
    const texts = instance.session.messages.flatMap((row) =>
      row.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])))
    expect(texts).toContain('## Findings\n\nOne real bug.')
    // The stdout carrier message is replaced, not left beside the report.
    expect(texts).not.toContain('Command output follows')
  })

  it('keeps other commands out of the transcript but reachable', () => {
    const { instance } = runtime()
    instance.send('/doctor')
    instance.ingest(assistant('m2', '<local-command-stdout>lots of noise</local-command-stdout>'))
    instance.ingest([outputEvent('m2', 'lots of noise')])
    expect(instance.slashCommandOutput).toEqual({ command: 'doctor', content: 'lots of noise' })
    const texts = instance.session.messages.flatMap((row) =>
      row.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])))
    expect(texts).toContain('Command /doctor executed.')
  })

  it('drops the compact prompt and its output entirely', () => {
    const { instance } = runtime()
    instance.ingest(message('u1', 'user', '/compact'))
    instance.send('/compact')
    instance.ingest(assistant('m3', 'compacted'))
    instance.ingest([outputEvent('m3', 'summary text')])
    expect(instance.session.messages.some((row) => row.id === 'm3')).toBe(false)
    expect(instance.slashCommandOutput).toBeNull()
  })

  it('forgets the command once its output has arrived', () => {
    const { instance } = runtime()
    instance.send('/doctor')
    instance.ingest(assistant('m4', 'x'))
    instance.ingest([outputEvent('m4', 'noise')])
    instance.clearSlashCommandOutput()
    expect(instance.slashCommandOutput).toBeNull()
    // A plain message afterwards must not be attributed to the old command.
    instance.send('hello')
    instance.ingest(assistant('m5', 'hi'))
    instance.ingest([outputEvent('m5', 'stray')])
    expect(instance.slashCommandOutput).toEqual({ command: '', content: 'stray' })
  })
})
