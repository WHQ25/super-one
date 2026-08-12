import { describe, expect, it } from 'vitest'
import { withDraftCarry } from './draft-surface-select'

describe('withDraftCarry', () => {
  it('always sets carryOpenDraft so Add Project cannot park the draft by default', () => {
    expect(withDraftCarry()).toEqual({ carryOpenDraft: true })
    expect(withDraftCarry({ connectionId: 'local' })).toEqual({
      connectionId: 'local',
      carryOpenDraft: true,
    })
    expect(withDraftCarry({ connectionId: 'node-1', projectId: 'p1' })).toEqual({
      connectionId: 'node-1',
      projectId: 'p1',
      carryOpenDraft: true,
    })
  })

  it('forces carryOpenDraft true even when false is spread in', () => {
    const sneaky = { carryOpenDraft: false as boolean }
    expect(withDraftCarry(sneaky as { connectionId?: string }).carryOpenDraft).toBe(true)
  })
})
