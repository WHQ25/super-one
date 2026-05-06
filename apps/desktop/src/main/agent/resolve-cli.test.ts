import { describe, expect, it, vi } from 'vitest'

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

import { dedupePath } from './resolve-cli'

describe('dedupePath', () => {
  it('removes duplicate entries preserving first-seen order', () => {
    expect(dedupePath('/a:/b:/a:/c:/b')).toBe('/a:/b:/c')
  })

  it('drops empty entries from leading/trailing/adjacent colons', () => {
    expect(dedupePath(':/a::/b:')).toBe('/a:/b')
  })

  it('returns empty string for empty input', () => {
    expect(dedupePath('')).toBe('')
  })

  it('handles real-world bloated PATH with repeated inits', () => {
    const bloated = [
      '/Users/jeff/.antigravity/antigravity/bin',
      '/Users/jeff/.antigravity/antigravity/bin',
      '/Users/jeff/.cargo/bin',
      '/opt/homebrew/bin',
      '/Users/jeff/.cargo/bin',
      '/opt/homebrew/bin',
    ].join(':')
    const result = dedupePath(bloated)
    expect(result).toBe('/Users/jeff/.antigravity/antigravity/bin:/Users/jeff/.cargo/bin:/opt/homebrew/bin')
    expect(result.length).toBeLessThan(bloated.length)
  })
})
