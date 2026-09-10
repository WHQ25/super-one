import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../remote-content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../remote-content')>()
  return { ...actual, stripMessagesForRemote: (messages: unknown) => messages }
})
import type { ChatMessage } from '@superone/shared/agent-types'
import { detailUpdates, projectProgressiveEvent, projectProgressiveMessage, setProgressiveSession, subscribeDetail, unsubscribeDetail } from './progressive-session'
const message = (): ChatMessage => ({ id: 'm', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'claude', content: [
  { type: 'thinking', thinking: 'private reasoning', startedAt: 100 },
  { type: 'tool_use', toolName: 'Write', toolUseId: 't', input: JSON.stringify({ file_path: 'a.ts', content: 'large code' }), status: 'streaming' },
  { type: 'tool_result', toolUseId: 't', summary: 'large output' },
] })
afterEach(() => { setProgressiveSession('a'); setProgressiveSession('b') })
describe('progressive session projection', () => {
  it('retains shell state without hidden text, input, output, or mutation', () => {
    const original = message()
    const projected = projectProgressiveMessage(original)
    const wire = JSON.stringify(projected)
    expect(wire).not.toContain('private reasoning')
    expect(wire).not.toContain('large code')
    expect(wire).not.toContain('large output')
    expect(projected.content[0]).toMatchObject({ startedAt: 100, remoteDetail: '["m","thinking",0]' })
    expect(projected.content[1]).toMatchObject({ toolName: 'Write', toolLineDelta: { added: 1, removed: 0 } })
    expect(original.content[0]).toMatchObject({ thinking: 'private reasoning' })
  })
  it('sends no detail to a collapsed device and only additive text to the expanded device', () => {
    const source = message()
    setProgressiveSession('a', 's'); setProgressiveSession('b', 's')
    expect(subscribeDetail('a', 's', 'sub', '["m","thinking",0]', source)).toMatchObject({ text: 'private reasoning', revision: 0 })
    source.content[0] = { type: 'thinking', thinking: 'private reasoning more' }
    expect(detailUpdates('b', 's', [source])).toEqual([])
    expect(detailUpdates('a', 's', [source])).toEqual([{ type: 'remote_detail', sessionId: 's', subscriptionId: 'sub', revision: 1, offset: 17, text: ' more' }])
    expect(detailUpdates('a', 's', [source])).toEqual([])
    unsubscribeDetail('a', 's', 'sub')
    source.content[0] = { type: 'thinking', thinking: 'private reasoning more again' }
    expect(detailUpdates('a', 's', [source])).toEqual([])
  })
  it('replaces revised content and clears interests on reconnect/session switch', () => {
    const source = message()
    setProgressiveSession('a', 's')
    subscribeDetail('a', 's', 'sub', '["m","thinking",0]', source)
    source.content[0] = { type: 'thinking', thinking: 'replacement' }
    expect(detailUpdates('a', 's', [source])[0]).toMatchObject({ offset: 0, text: 'replacement' })
    setProgressiveSession('a', 'other')
    expect(detailUpdates('a', 's', [source])).toEqual([])
    expect(() => subscribeDetail('a', 's', 'sub', '["m","thinking",0]', source)).toThrow('expired')
  })
  it('strips Codex baseline, patches, and completion metadata without losing item IDs', () => {
    const source = { ...message(), metadata: { codex: { threadId: 'thread', usage: null, items: [
      { id: 'r', type: 'reasoning' as const, text: 'private reasoning' },
      { id: 'c', type: 'command_execution' as const, command: 'pwd', aggregatedOutput: 'large output', status: 'in_progress' as const },
    ] } } }
    expect(JSON.stringify(projectProgressiveMessage(source))).not.toMatch(/private reasoning|large output/)
    expect(projectProgressiveMessage(source).metadata?.codex?.items[0]).toMatchObject({ id: 'r', remoteDetail: '["m","reasoning","r"]' })
    expect(projectProgressiveEvent({ type: 'codex_item_patch', messageId: 'm', phase: 'updated', itemId: 'r', patch: { type: 'reasoning', textDelta: 'private reasoning' } }, [source])).toMatchObject({ patch: { textDelta: '' } })
    expect(JSON.stringify(projectProgressiveEvent({ type: 'message_complete', messageId: 'm', metadata: source.metadata }, [source]))).not.toMatch(/private reasoning|large output/)
  })
  it('fetches original tool input and full result only on expansion', () => {
    setProgressiveSession('a', 's')
    const detail = subscribeDetail('a', 's', 'tool', '["m","tool","t"]', message())
    expect(JSON.parse(detail.text)).toMatchObject({ result: 'large output', input: JSON.stringify({ file_path: 'a.ts', content: 'large code' }) })
  })
  it('projects a live Edit delta with line counts and no replaced bodies', () => {
    const projected = projectProgressiveEvent({
      type: 'content_delta',
      sessionId: 's',
      messageId: 'm',
      delta: {
        type: 'tool_use',
        toolName: 'Edit',
        toolUseId: 't',
        input: JSON.stringify({ file_path: 'a.ts', old_string: 'const enabled = false', new_string: 'const enabled = true' }),
        status: 'streaming',
      },
    }, [])
    expect(projected).toMatchObject({
      remoteView: 'summary',
      delta: { toolName: 'Edit', toolLineDelta: { added: 1, removed: 1 }, remoteDetail: '["m","tool","t"]' },
    })
    expect(JSON.stringify(projected)).not.toContain('old_string')
    expect(JSON.stringify(projected)).not.toContain('const enabled')
  })
  it('keeps a browser screenshot path in the summary so the phone can load the image', () => {
    const source: ChatMessage = {
      id: 'm',
      role: 'assistant',
      status: 'complete',
      createdAt: '',
      providerId: 'claude',
      content: [
        {
          type: 'tool_use',
          toolName: 'mcp__superone__browser_snapshot',
          toolUseId: 'shot',
          input: JSON.stringify({ include: ['screenshot'], description: 'Google home' }),
          status: 'complete',
        },
        {
          type: 'tool_result',
          toolUseId: 'shot',
          summary: JSON.stringify({ path: '/tmp/google.png', width: 960, height: 1636, outline: 'x'.repeat(400) }),
        },
      ],
    }
    const projected = projectProgressiveMessage(source)
    const result = projected.content.find((block) => block.type === 'tool_result')
    expect(result).toMatchObject({ type: 'tool_result', toolUseId: 'shot' })
    expect(JSON.parse((result as { summary: string }).summary)).toEqual({
      path: '/tmp/google.png',
      width: 960,
      height: 1636,
    })
    expect(JSON.stringify(projected)).not.toContain('outline')
  })
  it('unwraps an MCP envelope before keeping the screenshot path', () => {
    const inner = JSON.stringify({ path: '/tmp/google.png', width: 10, height: 10 })
    const source: ChatMessage = {
      id: 'm',
      role: 'assistant',
      status: 'complete',
      createdAt: '',
      providerId: 'claude',
      content: [
        {
          type: 'tool_use',
          toolName: 'mcp__superone__browser_snapshot',
          toolUseId: 'shot',
          input: JSON.stringify({ include: ['screenshot'] }),
          status: 'complete',
        },
        {
          type: 'tool_result',
          toolUseId: 'shot',
          summary: JSON.stringify({ content: [{ type: 'text', text: inner }], isError: false }),
        },
      ],
    }
    const result = projectProgressiveMessage(source).content.find((block) => block.type === 'tool_result') as { summary: string }
    expect(JSON.parse(result.summary)).toMatchObject({ path: '/tmp/google.png' })
  })
})

it('keeps a large hidden payload out of the initial view', () => {
  const source = message()
  source.content[0] = { type: 'thinking', thinking: 'R'.repeat(300_000) }
  source.content[1] = { type: 'tool_use', toolName: 'Write', toolUseId: 't', input: JSON.stringify({ file_path: 'a.ts', content: 'C'.repeat(500_000) }) }
  source.content[2] = { type: 'tool_result', toolUseId: 't', summary: 'O'.repeat(500_000) }
  const before = Buffer.byteLength(JSON.stringify(source))
  const after = Buffer.byteLength(JSON.stringify(projectProgressiveMessage(source)))
  expect(before).toBeGreaterThan(1_300_000)
  expect(after).toBeLessThan(1_000)
  console.info('[ProgressivePayload]', JSON.stringify({ rawBytes: before, shellBytes: after }))
})

it('chunks large detail changes into bounded, reconstructable packets', () => {
  const source = message()
  setProgressiveSession('a', 's')
  const initial = subscribeDetail('a', 's', 'sub', '["m","thinking",0]', source)
  const expected = 'replacement '.repeat(20_000)
  source.content[0] = { type: 'thinking', thinking: expected }
  let text = initial.text
  const updates = detailUpdates('a', 's', [source])
  expect(updates.length).toBeGreaterThan(1)
  for (const update of updates) {
    if (update.type !== 'remote_detail') throw new Error('wrong update')
    expect(update.text.length).toBeLessThanOrEqual(64_000)
    text = text.slice(0, update.offset) + update.text
  }
  expect(text).toBe(expected)
})
