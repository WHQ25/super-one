import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), app: { getPath: vi.fn(() => '/tmp') } }))
vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { readMediaGuideHandler } from './media-tools'
import { MEDIA_GUIDE_TOPICS } from './superone-mcp-builtin-defs'

describe('readMediaGuideHandler', () => {
  it('returns non-empty, distinct content for every declared topic', () => {
    const seen = new Set<string>()
    for (const topic of MEDIA_GUIDE_TOPICS) {
      const result = readMediaGuideHandler({ topic })
      const text = result.content[0].text
      expect(text.length, `${topic} guide content`).toBeGreaterThan(0)
      expect(seen.has(text), `${topic} guide duplicates another topic's content`).toBe(false)
      seen.add(text)
    }
  })

  it('throws on an unknown topic instead of returning empty content', () => {
    expect(() => readMediaGuideHandler({ topic: 'not-a-real-topic' })).toThrow(/Unknown media guide topic/)
  })
})
