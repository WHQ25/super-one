import { describe, expect, it, vi } from 'vitest'
import { requestMentionIcons, requestMentionSearch } from './mention-search'
import { parseMentionItems } from './mentions'

const PNG = 'iVBORw0KGgoAAAANSUhEUg=='

describe('icons by id', () => {
  it('tells the host it can cache, so the answer carries ids not bytes', async () => {
    const sent: Record<string, unknown>[] = []
    const client = { request: vi.fn(async (command: unknown) => { sent.push(command as Record<string, unknown>); return {} }) }
    await requestMentionSearch(client, '/work/app', 'saf')
    expect(sent[0]).toMatchObject({ iconsById: true })
  })

  it('keeps the row icon id so the bytes can arrive later', () => {
    const [item] = parseMentionItems([{ kind: 'desktop-app', path: 'com.apple.Safari', iconId: 'abc123' }])
    expect(item).toMatchObject({ iconId: 'abc123' })
    expect(item?.iconPng).toBeUndefined()
  })

  it('still accepts inlined bytes from a host that predates ids', () => {
    const [item] = parseMentionItems([
      { kind: 'desktop-app', path: 'com.apple.Safari', iconDataUri: `data:image/png;base64,${PNG}` },
    ])
    expect(item?.iconPng).toBe(PNG)
  })

  it('asks for nothing when it needs nothing', async () => {
    const client = { request: vi.fn() }
    expect(await requestMentionIcons(client, [])).toEqual({})
    expect(client.request).not.toHaveBeenCalled()
  })

  it('validates fetched bytes the same way inlined ones are validated', async () => {
    // The host is the user's own desktop, not a trusted encoder: an oversized
    // or non-PNG payload must not reach an <Image> source.
    const client = {
      request: async () => ({ icons: {
        good: `data:image/png;base64,${PNG}`,
        notPng: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        huge: `data:image/png;base64,${'A'.repeat(300_000)}`,
      } }),
    }
    expect(await requestMentionIcons(client, ['good', 'notPng', 'huge'])).toEqual({ good: PNG })
  })

  it('treats a host that cannot answer as having no icons', async () => {
    const client = { request: async () => ({ error: 'no session' }) }
    expect(await requestMentionIcons(client, ['a'])).toEqual({})
  })
})
