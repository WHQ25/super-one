import { describe, expect, it } from 'vitest'
import { createDetailClient, type DetailTarget, type DetailTransport } from '@superone/chat-core'
import type { AgentEvent, ChatMessage, CodexThreadItem } from '@superone/shared/agent-types'
import { deliveryPolicy } from '../delivery-policy'
import { ConnectionDelivery } from './connection-delivery'
import { detailMessageId } from './projection'

/**
 * A summarized row expanded end to end: the host connection's projection and
 * detail views behind a transport, the shared client in front of it. Live
 * packets reach the client the way a session stream delivers them.
 */
function link(messages: () => ChatMessage[]) {
  const host = new ConnectionDelivery(deliveryPolicy('relay', 'desktop'))
  host.views.open('s')
  const transport: DetailTransport = {
    subscribe: async (target, subscriptionId) => {
      const message = messages().find((candidate) => candidate.id === detailMessageId(target.detailRef))
      if (!message) throw new Error('Detail not found')
      return host.views.subscribe(target.sessionId, subscriptionId, target.detailRef, message)
    },
    unsubscribe: (target, subscriptionId) => host.views.unsubscribe(target.sessionId, subscriptionId),
  }
  let ids = 0
  const client = createDetailClient(transport, { newId: () => `d${++ids}` })
  const expand = async (detailRef: string, complete = false) => {
    const state = { text: '', error: '' }
    const target: DetailTarget = { environmentId: 'node-b', sessionId: 's', detailRef }
    const close = client.open([target], { complete, onText: (text) => { state.text = text }, onError: (error) => { state.error = error }, onSettled: () => {} })
    await new Promise((resolve) => setTimeout(resolve, 0))
    return { state, close }
  }
  /** One live event: what the connection would send, with packets fed back to the client. */
  const live = (event: AgentEvent): AgentEvent[] => {
    const out = host.live(event, 's', messages())
    for (const update of out) if (update.type === 'remote_detail') client.deliver(update)
    return out
  }
  return { host, expand, live }
}

describe('detail round trip', () => {
  it('expands a subagent card into its children and follows them as they stream', async () => {
    let message: ChatMessage = { id: 'm', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'claude', content: [
      { type: 'tool_use', toolName: 'Agent', toolUseId: 'agent', input: JSON.stringify({ description: 'Explore', prompt: 'look around' }), status: 'streaming' },
      { type: 'tool_use', toolName: 'Read', toolUseId: 'read', input: JSON.stringify({ file_path: '/p/a.ts' }), status: 'complete', parentToolUseId: 'agent' },
    ] }
    const { expand, live } = link(() => [message])
    const [card] = live({ type: 'message_start', sessionId: 's', message })
    const shell = (card as Extract<AgentEvent, { type: 'message_start' }>).message.content
    expect(shell).toHaveLength(1)
    const ref = (shell[0] as { remoteDetail?: string }).remoteDetail!
    const row = await expand(ref)
    expect(JSON.parse(row.state.text).childBlocks).toMatchObject([{ toolName: 'Read', toolUseId: 'read' }])

    message = { ...message, content: [...message.content,
      { type: 'tool_use', toolName: 'Grep', toolUseId: 'grep', input: JSON.stringify({ pattern: 'x' }), status: 'complete', parentToolUseId: 'agent' }] }
    live({ type: 'content_delta', sessionId: 's', messageId: 'm', delta: message.content[2]! } as AgentEvent)
    expect(JSON.parse(row.state.text).childBlocks.map((block: { toolName?: string }) => block.toolName).filter(Boolean)).toEqual(['Read', 'Grep'])
    expect(row.state.error).toBe('')
    row.close()
  })

  it('expands a Codex file change into its diff', async () => {
    const item: CodexThreadItem = { id: 'patch', type: 'file_change', status: 'completed',
      changes: [{ path: '/p/a.ts', kind: 'update', diff: '@@ -1 +1 @@\n-before\n+after' }] } as CodexThreadItem
    const message: ChatMessage = { id: 'm', role: 'assistant', status: 'complete', createdAt: '', providerId: 'codex', content: [],
      metadata: { codex: { items: [item] } } } as unknown as ChatMessage
    const { expand, host } = link(() => [message])
    const [projected] = host.messages([message], 's')
    const shell = projected!.metadata!.codex!.items[0] as CodexThreadItem & { remoteDetail?: string }
    expect(JSON.stringify(shell)).not.toContain('before')
    const row = await expand(shell.remoteDetail!, true)
    expect(JSON.parse(row.state.text).item).toMatchObject({ type: 'file_change', changes: [{ path: '/p/a.ts', diff: expect.stringContaining('+after') }] })
  })
})
