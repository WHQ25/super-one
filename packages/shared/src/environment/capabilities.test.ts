import { describe, expect, it } from 'vitest'
import { servesMethod } from './capabilities'

describe('servesMethod', () => {
  it('reads the methods an environment reports, and nothing while they are unknown', () => {
    expect(servesMethod({ methods: ['draft.list'] }, 'draft.list')).toBe(true)
    expect(servesMethod({ methods: ['draft.list'] }, 'terminal.create')).toBe(false)
    expect(servesMethod(undefined, 'draft.list')).toBe(false)
    expect(servesMethod({}, 'draft.list')).toBe(false)
  })
})
