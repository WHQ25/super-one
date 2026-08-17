import { describe, expect, it } from 'vitest'
import { resolveModelIconKey } from './ModelGlyph'

describe('resolveModelIconKey', () => {
  it('prefers the model id when it already maps to an icon', () => {
    expect(resolveModelIconKey('gpt-4o', 'Claude')).toBe('gpt-4o')
  })

  it('falls back to the display name when the raw id has no icon', () => {
    expect(resolveModelIconKey('sk-relay-slot-1', 'GPT-4o')).toBe('GPT-4o')
  })

  it('returns null when neither the id nor the display name maps', () => {
    expect(resolveModelIconKey('sk-relay-slot-1', 'Totally Unknown')).toBeNull()
  })

  it('maps the GA flash-image id to Nano Banana, not generic Gemini', () => {
    expect(resolveModelIconKey('gemini-3.1-flash-image')).toBe('gemini-3.1-flash-image')
    expect(resolveModelIconKey('gemini-3.1-flash-image', 'Nano Banana 2')).toBe('gemini-3.1-flash-image')
  })

  it('keeps the official preview id that already maps to Nano Banana', () => {
    expect(resolveModelIconKey('gemini-3.1-flash-image-preview')).toBe('gemini-3.1-flash-image-preview')
  })
})
