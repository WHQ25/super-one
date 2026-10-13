import { expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { StreamingInputProjection } from './streaming-input-projection'

it('projects growing previews with stable rows, preserves raw input, and uses final input after completion', () => {
  const projection = new StreamingInputProjection()
  const row: ChatMessage = { id: 'a', role: 'assistant', status: 'streaming', providerId: 'opencode', createdAt: '',
    content: [{ type: 'tool_use', toolUseId: 't', toolName: 'Write', input: '{}', status: 'streaming' }] }
  const preview = { file_path: '/a.ts', content: 'hel' }
  const first = projection.project([row], { t: preview })[0]
  expect(first.content[0]).toMatchObject({ input: JSON.stringify(preview) })
  expect(projection.project([row], { t: preview })[0]).toBe(first)
  expect(row.content[0]).toMatchObject({ input: '{}' })
  expect(projection.project([row], { t: { ...preview, content: 'hello' } })[0]).not.toBe(first)
  const final: ChatMessage = { ...row, status: 'complete', content: [{ type: 'tool_use', toolUseId: 't', toolName: 'Write', input: '{"file_path":"/a.ts","content":"hello!"}', status: 'complete' }] }
  expect(projection.project([final], { t: preview })[0]).toBe(final)
})
