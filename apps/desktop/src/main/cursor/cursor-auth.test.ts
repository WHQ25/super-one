import { describe, expect, it } from 'vitest'
import { mapPermissionToCursorLocal, readCursorConfig, resolveCursorApiKey } from './cursor-auth'

describe('cursor-auth', () => {
  it('maps plan and auto-review modes honestly', () => {
    expect(mapPermissionToCursorLocal('plan')).toEqual({
      mode: 'plan',
      sandboxEnabled: true,
      autoReview: false,
    })
    expect(mapPermissionToCursorLocal('auto')).toEqual({
      mode: 'agent',
      sandboxEnabled: true,
      autoReview: true,
    })
    expect(mapPermissionToCursorLocal('bypassPermissions')).toEqual({
      mode: 'agent',
      sandboxEnabled: true,
      autoReview: false,
    })
  })

  it('resolves api key from config then env', () => {
    const prev = process.env.CURSOR_API_KEY
    delete process.env.CURSOR_API_KEY
    expect(resolveCursorApiKey({ apiKey: 'cursor_test' })).toBe('cursor_test')
    process.env.CURSOR_API_KEY = 'from_env'
    expect(resolveCursorApiKey({})).toBe('from_env')
    if (prev === undefined) delete process.env.CURSOR_API_KEY
    else process.env.CURSOR_API_KEY = prev
  })

  it('reads cursor config fields', () => {
    expect(readCursorConfig({ model: 'composer-2', mode: 'plan', sandboxEnabled: true })).toMatchObject({
      model: 'composer-2',
      mode: 'plan',
      sandboxEnabled: true,
    })
  })
})
