import { describe, expect, it } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createDeepseekTree } from './tree'

/** Reach the mounted seam the way the DeepSeek adapter does. */
async function credentialsOf(lookup: (ref: string) => string | undefined) {
  const ctx = await createDeepseekTree({ credentialLookup: lookup })
  await new Promise((resolve) => setTimeout(resolve, 50))
  const service = (ctx as unknown as { get(key: string): unknown }).get('credentials')
  return service as {
    resolve(ref: unknown): Promise<{ value: string; source: string } | undefined>
    describe(ref: unknown): Promise<{ configured: boolean; source?: string; writable: boolean }>
  }
}

describe('SuperOne credential seam', () => {
  it('serves the adapter its reference out of SuperOne storage, never process.env', async () => {
    const credentials = await credentialsOf((ref) => (ref === 'DEEPSEEK_API_KEY' ? 'sk-from-superone' : undefined))

    await expect(credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))).resolves.toEqual({
      value: 'sk-from-superone',
      source: 'superone',
    })
    await expect(credentials.resolve(credentialRef('SOMETHING_ELSE'))).resolves.toBeUndefined()
  })

  it('re-reads the store per resolution so a re-bound key reaches the next request', async () => {
    let current: string | undefined
    const credentials = await credentialsOf(() => current)

    await expect(credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))).resolves.toBeUndefined()
    current = 'sk-rebound'
    await expect(credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))).resolves.toMatchObject({
      value: 'sk-rebound',
    })
  })

  it('treats an empty stored value as unconfigured', async () => {
    const credentials = await credentialsOf(() => '')

    await expect(credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))).resolves.toBeUndefined()
    await expect(credentials.describe(credentialRef('DEEPSEEK_API_KEY'))).resolves.toEqual({
      configured: false,
      writable: false,
    })
  })
})
