import { describe, expect, it } from 'vitest'
import { parseOpenCodeModelSlug, parseModels, parseOpenCodeCommands } from './parse'

describe('parseOpenCodeModelSlug', () => {
  it('splits provider/model', () => {
    expect(parseOpenCodeModelSlug('anthropic/claude-3')).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-3',
    })
  })

  it('rejects invalid', () => {
    expect(parseOpenCodeModelSlug('')).toBeNull()
    expect(parseOpenCodeModelSlug('nopath')).toBeNull()
  })
})

describe('parseModels', () => {
  it('maps connected providers', () => {
    const models = parseModels({
      connected: ['p1'],
      default: { p1: 'm1' },
      all: [
        {
          id: 'p1',
          name: 'P1',
          models: {
            m1: {
              id: 'm1',
              name: 'Model 1',
              limit: { context: 1000 },
              capabilities: { reasoning: false },
            },
          },
        },
      ],
    })
    expect(models).toEqual([
      expect.objectContaining({ id: 'p1/m1', name: 'Model 1', isDefault: true }),
    ])
  })
})

describe('parseOpenCodeCommands', () => {
  it('strips slash and maps skill flag', () => {
    expect(
      parseOpenCodeCommands([{ name: '/ship', description: 'Ship', hints: ['x'], source: 'skill' }]),
    ).toEqual([{ name: 'ship', description: 'Ship', argumentHint: 'x', isSkill: true }])
  })
})
