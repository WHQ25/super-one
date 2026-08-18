import { describe, expect, it } from 'vitest'
import {
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_MODEL_CATALOG,
} from './deepseek-runtime-host'

describe('DeepSeek runtime model catalog', () => {
  it('defines human-readable names for every model exposed to the picker', () => {
    expect(DEEPSEEK_MODEL_CATALOG).toEqual([
      expect.objectContaining({ id: DEEPSEEK_DEFAULT_MODEL, name: 'DeepSeek V4 Pro' }),
      expect.objectContaining({ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }),
    ])
    expect(DEEPSEEK_MODEL_CATALOG.every((model) => model.name !== model.id)).toBe(true)
  })
})
