import { describe, expect, it, vi } from 'vitest'
import { ChatRuntime } from './runtime'
import { runtimeTestClient } from './runtime-test-client'

const content = [
  { type: 'text' as const, text: 'Before', isPaste: false },
  { type: 'text' as const, text: 'short paste', isPaste: true },
  { type: 'text' as const, text: 'after', isPaste: false },
]

describe('composer identity in optimistic and host messages', () => {
  it.each([undefined, 'next'] as const)('sends the same paste blocks the %s bubble paints', (priority) => {
    const client = runtimeTestClient()
    const runtime = new ChatRuntime(client as never, () => {}); runtime.sessionId = 's'
    runtime.send('Before short paste after', { clientMessageId: 'paste', priority, userMessageContent: content })
    const message = (priority ? runtime.session.queuedMessages : runtime.session.messages)[0]
    expect(message.content).toEqual(content)
    expect(client.dispatch).toHaveBeenCalledWith(expect.objectContaining({ userMessageContent: content }))
    runtime.dispose()
  })

  it('marks a new plain long message on both the phone and wire', () => {
    const client = runtimeTestClient()
    const runtime = new ChatRuntime(client as never, () => {}); runtime.sessionId = 's'
    const text = 'x'.repeat(500)
    runtime.send(text)
    const expected = [{ type: 'text', text, isPaste: false }]
    expect(runtime.session.messages[0].content).toEqual(expected)
    expect(client.dispatch).toHaveBeenCalledWith(expect.objectContaining({ userMessageContent: expected }))
    runtime.dispose()
  })

  it('retains paste blocks in the staged first message alongside attachments', () => {
    const runtime = new ChatRuntime({ request: vi.fn() } as never, () => {})
    const image = { id: 'i', name: 'image.png', mimeType: 'image/png', base64: 'AA==' }
    runtime.stageTurn('first', 'Before short paste after', [image], content)
    expect(runtime.session.messages[0].content).toEqual([{ type: 'image', id: 'i', name: 'image.png' }, ...content])
    runtime.dispose()
  })
})
