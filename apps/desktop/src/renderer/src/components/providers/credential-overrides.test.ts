/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { pruneOverrides } from './CredentialConfig'

describe('pruneOverrides media models', () => {
  it('keeps media model rows with a non-empty id and drops blank ones', () => {
    const out = pruneOverrides({
      images: { models: [{ id: 'dall-e-3', tasks: ['image'] }, { id: '', tasks: ['image'] }, { id: '   ', tasks: ['image'] }] },
    })
    expect(out).toEqual({ images: { models: [{ id: 'dall-e-3', tasks: ['image'] }] } })
  })

  it('drops an endpoint override whose media model list is empty', () => {
    expect(pruneOverrides({ images: { models: [] } })).toEqual({})
    expect(pruneOverrides({ images: { models: [{ id: '' }] } })).toEqual({})
  })

  it('preserves media models alongside other override fields', () => {
    const out = pruneOverrides({
      images: { baseUrl: 'https://x/v1', models: [{ id: 'sd-3.5', tasks: ['image'] }], extraEnv: { K: 'V' } },
    })
    expect(out.images).toEqual({ baseUrl: 'https://x/v1', models: [{ id: 'sd-3.5', tasks: ['image'] }], extraEnv: { K: 'V' } })
  })
})
