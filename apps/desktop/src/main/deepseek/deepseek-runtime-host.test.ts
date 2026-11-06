import { describe, expect, it } from 'vitest'
import { modelAcceptsImages } from '@superone/deepseek/images'
import {
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_MODEL_CATALOG,
} from './deepseek-runtime-host'

describe('DeepSeek runtime model catalog', () => {
  it('defines human-readable names for every model exposed to the picker', () => {
    expect(DEEPSEEK_MODEL_CATALOG).toEqual([
      expect.objectContaining({ id: DEEPSEEK_DEFAULT_MODEL, name: 'DeepSeek V4 Pro' }),
      expect.objectContaining({ id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' }),
    ])
    expect(DEEPSEEK_MODEL_CATALOG.every((model) => model.name !== model.id)).toBe(true)
  })

  it('offers image input on the flash route only', () => {
    // `modelAcceptsImages` reads this field to decide whether a composer
    // attachment may be committed to the durable store at all, so declaring it
    // on a text-only route would admit an image the adapter then refuses.
    const accepting = DEEPSEEK_MODEL_CATALOG
      .filter((model) => modelAcceptsImages(
        'inputModalities' in model ? model.inputModalities : undefined,
      ))
      .map((model) => model.id)

    expect(accepting).toEqual(['deepseek-flash'])
  })

  it('uses the official capacities instead of the smaller generic fallback', () => {
    // Both official models declare this capacity in the pinned upstream
    // catalog; omitting it would use the generic decimal 1M fallback.
    const capacities = DEEPSEEK_MODEL_CATALOG.map((model) =>
      'contextWindow' in model ? model.contextWindow : undefined,
    )

    expect(capacities).toEqual([1_048_576, 1_048_576])
  })

  it('keeps Flash tool additions in history as required by its upstream route', () => {
    expect(DEEPSEEK_MODEL_CATALOG.find((model) => model.id === 'deepseek-flash'))
      .toMatchObject({ systemPromptUpdate: 'in-history', toolUpdate: 'addition-only' })
  })
})
