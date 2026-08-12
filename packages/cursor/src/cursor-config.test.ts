import { describe, expect, it } from 'vitest'
import {
  buildCloudOptions,
  mapPermissionToCursorLocal,
  readCursorConfig,
  resolveCursorApiKeyPlain,
} from './cursor-config'

describe('cursor-config', () => {
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

  it('resolves api key from plaintext config then env', () => {
    const prev = process.env.CURSOR_API_KEY
    delete process.env.CURSOR_API_KEY
    expect(resolveCursorApiKeyPlain({ apiKey: 'cursor_test' })).toBe('cursor_test')
    expect(resolveCursorApiKeyPlain({ apiKey: 'enc:v1:deadbeef' })).toBeUndefined()
    process.env.CURSOR_API_KEY = 'from_env'
    expect(resolveCursorApiKeyPlain({})).toBe('from_env')
    expect(resolveCursorApiKeyPlain({ apiKey: 'enc:v1:deadbeef' })).toBe('from_env')
    if (prev === undefined) delete process.env.CURSOR_API_KEY
    else process.env.CURSOR_API_KEY = prev
  })

  it('reads cursor config fields', () => {
    expect(readCursorConfig({
      model: 'composer-2',
      mode: 'plan',
      sandboxEnabled: true,
      runtime: 'cloud',
      autoCreatePR: true,
      repos: [{ url: 'https://github.com/a/b' }],
    })).toMatchObject({
      model: 'composer-2',
      mode: 'plan',
      sandboxEnabled: true,
      runtime: 'cloud',
      autoCreatePR: true,
      repos: [{ url: 'https://github.com/a/b' }],
    })
  })

  it('builds cloud options from config', () => {
    expect(buildCloudOptions({
      cloudEnvType: 'pool',
      cloudEnvName: 'my-pool',
      repos: [{ url: 'https://github.com/a/b', startingRef: 'main' }],
      autoCreatePR: true,
      workOnCurrentBranch: true,
    })).toEqual({
      env: { type: 'pool', name: 'my-pool' },
      repos: [{ url: 'https://github.com/a/b', startingRef: 'main' }],
      autoCreatePR: true,
      workOnCurrentBranch: true,
    })
  })
})
