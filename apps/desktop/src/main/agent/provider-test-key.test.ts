import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProviderByIdRaw = vi.fn()
vi.mock('../database', () => ({ getProviderByIdRaw: (id: string) => getProviderByIdRaw(id) }))

const { resolveTestApiKey } = await import('./provider-test-key')

describe('resolveTestApiKey', () => {
  beforeEach(() => {
    getProviderByIdRaw.mockReset()
  })

  it('uses the freshly typed key as-is when creating a provider (no provider_id)', () => {
    expect(resolveTestApiKey({ api_key: 'sk-real-typed-key' })).toBe('sk-real-typed-key')
    expect(getProviderByIdRaw).not.toHaveBeenCalled()
  })

  it('falls back to the stored key when the form holds the masked sentinel from a reopened provider', () => {
    getProviderByIdRaw.mockReturnValue({ api_key: 'sk-stored-real-key' })

    expect(resolveTestApiKey({ api_key: '***abcdef', provider_id: 'p1' })).toBe('sk-stored-real-key')
    expect(getProviderByIdRaw).toHaveBeenCalledWith('p1')
  })

  it('falls back to the stored key when the form key is empty but a provider_id is known', () => {
    getProviderByIdRaw.mockReturnValue({ api_key: 'sk-stored-real-key' })

    expect(resolveTestApiKey({ api_key: '', provider_id: 'p1' })).toBe('sk-stored-real-key')
  })

  it('prefers a re-typed real key over the stored one even when editing', () => {
    getProviderByIdRaw.mockReturnValue({ api_key: 'sk-stored-real-key' })

    expect(resolveTestApiKey({ api_key: 'sk-newly-typed', provider_id: 'p1' })).toBe('sk-newly-typed')
    expect(getProviderByIdRaw).not.toHaveBeenCalled()
  })

  it('keeps the masked value when no provider_id and no stored key can be resolved', () => {
    expect(resolveTestApiKey({ api_key: '***abcdef' })).toBe('***abcdef')
    getProviderByIdRaw.mockReturnValue(undefined)
    expect(resolveTestApiKey({ api_key: '***abcdef', provider_id: 'missing' })).toBe('***abcdef')
  })
})
