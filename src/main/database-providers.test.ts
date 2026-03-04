import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('better-sqlite3', () => ({ default: vi.fn() }))

import { maskApiKey } from './database'

describe('maskApiKey', () => {
  it('masks key keeping last 6 chars', () => {
    expect(maskApiKey('sk-1234567890abcdef')).toBe('***abcdef')
  })

  it('returns *** for short keys', () => {
    expect(maskApiKey('abc')).toBe('***')
    expect(maskApiKey('123456')).toBe('***')
  })

  it('returns empty for empty key', () => {
    expect(maskApiKey('')).toBe('')
  })

  it('masks key with exactly 7 chars', () => {
    expect(maskApiKey('1234567')).toBe('***234567')
  })
})
