import { describe, expect, it } from 'vitest'
import { hasSelectableEffort, matchesModelSearch } from './GroupedModelEffortSelector'

describe('GroupedModelEffortSelector', () => {
  it('treats a single effort option as fixed', () => {
    expect(hasSelectableEffort([])).toBe(false)
    expect(hasSelectableEffort([{ value: 'high', label: 'High' }])).toBe(false)
    expect(hasSelectableEffort([{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }])).toBe(true)
  })

  it('matches model search against model fields', () => {
    const model = { id: 'provider/model-11', name: 'Model Eleven', description: 'Coding model' }
    expect(matchesModelSearch(model, 'model-11')).toBe(true)
    expect(matchesModelSearch(model, 'coding')).toBe(true)
    expect(matchesModelSearch(model, 'missing')).toBe(false)
  })
})
