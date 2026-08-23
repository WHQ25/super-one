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
      expect.objectContaining({ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }),
      expect.objectContaining({
        id: 'deepseek-v4-flash-vision-exp',
        name: 'DeepSeek V4 Flash Vision (Exp)',
      }),
    ])
    expect(DEEPSEEK_MODEL_CATALOG.every((model) => model.name !== model.id)).toBe(true)
  })

  it('offers image input on the vision route only', () => {
    // `modelAcceptsImages` reads this field to decide whether a composer
    // attachment may be committed to the durable store at all, so declaring it
    // on a text-only route would admit an image the adapter then refuses.
    const accepting = DEEPSEEK_MODEL_CATALOG
      .filter((model) => modelAcceptsImages(
        'inputModalities' in model ? model.inputModalities : undefined,
      ))
      .map((model) => model.id)

    expect(accepting).toEqual(['deepseek-v4-flash-vision-exp'])
  })

  it('leaves context capacity to the adapter on every route', () => {
    // A `contextWindow` written here IS the number — DeepSeek reports none —
    // and `compaction-basic` derives its trigger from it, so an
    // under-guess compacts a healthy conversation away early. Omitting it
    // defers to the adapter's own default, which is DeepSeek's published
    // figure and moves with the pin.
    const declared = DEEPSEEK_MODEL_CATALOG.filter((model) => 'contextWindow' in model)

    expect(declared).toEqual([])
  })
})
