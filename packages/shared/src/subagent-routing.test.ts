import { describe, it, expect } from 'vitest'
import type { ContentBlock } from './agent-types'
import { findToolUseMessageId, resolveDeltaHomeMessageId, resolveTaskToolUseId } from './subagent-routing'

const agent = (toolUseId: string): ContentBlock => ({ type: 'tool_use', toolName: 'Agent', toolUseId, input: '' } as ContentBlock)
const text = (t: string, parent: string | null): ContentBlock => ({ type: 'text', text: t, parentToolUseId: parent } as ContentBlock)

describe('findToolUseMessageId', () => {
  it('returns the id of the message owning the tool_use block', () => {
    const messages = [{ id: 'mA', content: [agent('O')] }, { id: 'mB', content: [text('x', null)] }]
    expect(findToolUseMessageId(messages, 'O')).toBe('mA')
    expect(findToolUseMessageId(messages, 'missing')).toBeUndefined()
  })
})

describe('resolveDeltaHomeMessageId', () => {
  const messages = [{ id: 'mA', content: [agent('O')] }, { id: 'mB', content: [] }]

  it('re-homes a parented delta to the message owning its Agent block', () => {
    expect(resolveDeltaHomeMessageId(messages, 'mB', text('resumed', 'O'))).toBe('mA')
  })
  it('keeps an unparented delta in its own message', () => {
    expect(resolveDeltaHomeMessageId(messages, 'mB', text('main', null))).toBe('mB')
  })
  it('keeps a delta whose parent already lives in the same message', () => {
    expect(resolveDeltaHomeMessageId(messages, 'mA', text('child', 'O'))).toBe('mA')
  })
  it('falls back to the source message when the parent block is not found yet', () => {
    expect(resolveDeltaHomeMessageId(messages, 'mB', text('orphan', 'unknown'))).toBe('mB')
  })
})

describe('resolveTaskToolUseId', () => {
  const taskProgress = { O: { taskId: 'T1' }, X: { taskId: 'T2' } }

  it('prefers a directly tracked toolUseId', () => {
    expect(resolveTaskToolUseId(taskProgress, 'O', 'T1')).toBe('O')
  })
  it('falls back to the entry matching taskId when the toolUseId is unknown', () => {
    expect(resolveTaskToolUseId(taskProgress, 'tu-waker', 'T1')).toBe('O')
  })
  it('returns the direct toolUseId when nothing matches', () => {
    expect(resolveTaskToolUseId(taskProgress, 'tu-new', 'T9')).toBe('tu-new')
  })
})
