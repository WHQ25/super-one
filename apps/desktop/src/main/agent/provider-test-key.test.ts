import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCredentialDecrypted = vi.fn()
vi.mock('../providers/credential-store', () => ({
  getCredentialDecrypted: (id: string) => getCredentialDecrypted(id),
}))

const { resolveTestApiKey } = await import('./provider-test-key')

describe('resolveTestApiKey', () => {
  beforeEach(() => {
    getCredentialDecrypted.mockReset()
  })

  it('uses the freshly typed key as-is when adding a key (no credential_id)', () => {
    expect(resolveTestApiKey({ api_key: 'sk-real-typed-key' })).toBe('sk-real-typed-key')
    expect(getCredentialDecrypted).not.toHaveBeenCalled()
  })

  it('falls back to the stored credential secret when the form holds the masked sentinel', () => {
    getCredentialDecrypted.mockReturnValue({ secret: 'sk-stored-real-key' })

    expect(resolveTestApiKey({ api_key: '***abcdef', credential_id: 'c1' })).toBe('sk-stored-real-key')
    expect(getCredentialDecrypted).toHaveBeenCalledWith('c1')
  })

  it('falls back to the stored secret when the form key is empty but a credential_id is known', () => {
    getCredentialDecrypted.mockReturnValue({ secret: 'sk-stored-real-key' })

    expect(resolveTestApiKey({ api_key: '', credential_id: 'c1' })).toBe('sk-stored-real-key')
  })

  it('reads the key from the credential env var when secretEnv is set', () => {
    process.env.RESOLVE_TEST_ENV_KEY = 'sk-from-env'
    getCredentialDecrypted.mockReturnValue({ secret: '', secretEnv: 'RESOLVE_TEST_ENV_KEY' })

    expect(resolveTestApiKey({ api_key: '', credential_id: 'c1' })).toBe('sk-from-env')
    delete process.env.RESOLVE_TEST_ENV_KEY
  })

  it('prefers a re-typed real key over the stored one even when editing', () => {
    getCredentialDecrypted.mockReturnValue({ secret: 'sk-stored-real-key' })

    expect(resolveTestApiKey({ api_key: 'sk-newly-typed', credential_id: 'c1' })).toBe('sk-newly-typed')
    expect(getCredentialDecrypted).not.toHaveBeenCalled()
  })

  it('keeps the masked value when no credential can be resolved', () => {
    expect(resolveTestApiKey({ api_key: '***abcdef' })).toBe('***abcdef')
    getCredentialDecrypted.mockReturnValue(undefined)
    expect(resolveTestApiKey({ api_key: '***abcdef', credential_id: 'missing' })).toBe('***abcdef')
  })
})
