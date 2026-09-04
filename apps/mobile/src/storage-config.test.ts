import { describe, expect, it } from 'vitest'
import { MMKV_KEY_ALIAS } from './storage-config'

describe('native storage configuration', () => {
  it('uses a key accepted by Expo SecureStore on iOS and Android', () => {
    expect(MMKV_KEY_ALIAS).toMatch(/^[A-Za-z0-9._-]+$/)
  })
})
