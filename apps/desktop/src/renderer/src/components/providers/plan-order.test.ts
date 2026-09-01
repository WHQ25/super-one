import { describe, expect, it } from 'vitest'
import type { Credential, Platform } from '@superone/shared/platform-registry'
import { plansByKeyCount } from './plan-order'

const platform: Platform = {
  id: 'minimax',
  brand: 'minimax',
  name: 'MiniMax',
  plans: [
    { id: 'cn', name: '中国版', auth: 'api-key', baseUrl: 'https://api.minimaxi.com', endpoints: [] },
    { id: 'global', name: 'Global', auth: 'api-key', baseUrl: 'https://api.minimax.io', endpoints: [] },
  ],
}

const key = (id: string, planId: string, platformId = 'minimax'): Credential => ({
  id,
  platformId,
  planId,
  name: id,
  secret: 'enc:v1:x',
  notes: '',
  sortOrder: 0,
})

describe('plansByKeyCount', () => {
  it('keeps registry order when no key is configured', () => {
    expect(plansByKeyCount(platform, []).map((p) => p.id)).toEqual(['cn', 'global'])
  })

  it('puts the plan holding the most keys first', () => {
    const creds = [key('a', 'global')]
    expect(plansByKeyCount(platform, creds).map((p) => p.id)).toEqual(['global', 'cn'])
  })

  it('ranks by key count, not by mere presence', () => {
    const creds = [key('a', 'cn'), key('b', 'global'), key('c', 'global')]
    expect(plansByKeyCount(platform, creds).map((p) => p.id)).toEqual(['global', 'cn'])
  })

  it('keeps registry order for ties', () => {
    const creds = [key('a', 'global'), key('b', 'cn')]
    expect(plansByKeyCount(platform, creds).map((p) => p.id)).toEqual(['cn', 'global'])
  })

  it('ignores keys belonging to other platforms', () => {
    const creds = [key('a', 'global', 'moonshot')]
    expect(plansByKeyCount(platform, creds).map((p) => p.id)).toEqual(['cn', 'global'])
  })
})
