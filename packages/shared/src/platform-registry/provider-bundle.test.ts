import { describe, expect, it } from 'vitest'
import type { Credential } from './types'
import { importProviderBundle, type ProviderBundleTarget } from './provider-bundle'

function memoryTarget(initial: Credential[]) {
  const credentials = new Map(initial.map((c) => [c.id, { ...c }]))
  const target: ProviderBundleTarget = {
    hasCredential: (id) => credentials.has(id),
    createCredential: (input) => credentials.set(input.id, { ...stored(input.id, ''), ...input }),
    updateCredential: (id, patch) => {
      const existing = credentials.get(id)!
      credentials.set(id, { ...existing, name: patch.name ?? existing.name, secret: patch.secret ?? existing.secret })
    },
    setBinding: () => {},
    upsertCustomPlatform: () => {},
    clear: (keep) => { for (const id of credentials.keys()) if (!keep.has(id)) credentials.delete(id) },
  }
  return { target, credentials }
}

function stored(id: string, secret: string): Credential {
  return { id, platformId: 'openai', planId: 'api', name: id, secret, overrides: {}, notes: '', sortOrder: 0 }
}

describe('importProviderBundle', () => {
  it.each([false, true])('keeps a stored key the sender sent empty (replaceAll: %s)', (replaceAll) => {
    const { target, credentials } = memoryTarget([stored('kept', 'sk-stored'), stored('replaced', 'sk-old'), stored('local', 'sk-local')])
    const result = importProviderBundle(target, {
      credentials: [{ ...stored('kept', ''), name: 'Renamed' }, stored('replaced', 'sk-new'), stored('fresh', '')],
    }, { replaceAll })
    expect(result.credentials).toBe(3)
    expect(credentials.get('kept')).toMatchObject({ name: 'Renamed', secret: 'sk-stored' })
    expect(credentials.get('replaced')?.secret).toBe('sk-new')
    expect(credentials.get('fresh')?.secret).toBe('')
    expect(credentials.has('local')).toBe(!replaceAll)
  })
})
