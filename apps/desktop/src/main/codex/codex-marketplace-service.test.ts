import { describe, expect, it, vi } from 'vitest'
import { CodexMarketplaceService } from './codex-marketplace-service'
import type { CodexExperimentService } from './codex-experiment-service'

function makeService(requestImpl: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>): CodexMarketplaceService {
  const stub = {
    withAppServerRequest: vi.fn(async (_projectPath: string, fn: (request: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>) => unknown) => {
      return fn(requestImpl)
    }),
  } as unknown as CodexExperimentService
  return new CodexMarketplaceService(stub)
}

describe('CodexMarketplaceService', () => {
  it('add() trims source, omits optional fields when not provided, and maps the response', async () => {
    const service = makeService(async (method, params) => {
      expect(method).toBe('marketplace/add')
      expect(params).toEqual({ source: 'openai/codex-plugins' })
      return { marketplaceName: 'openai/codex-plugins', installedRoot: '/home/u/.codex/marketplaces/openai-codex-plugins', alreadyAdded: false }
    })
    const result = await service.add('/p', { source: '  openai/codex-plugins  ' })
    expect(result).toEqual({
      marketplaceName: 'openai/codex-plugins',
      installedRoot: '/home/u/.codex/marketplaces/openai-codex-plugins',
      alreadyAdded: false,
    })
  })

  it('add() forwards refName and sparsePaths when provided', async () => {
    const service = makeService(async (_method, params) => {
      expect(params).toEqual({ source: 'git@github.com:org/mp', refName: 'main', sparsePaths: ['plugins/a', 'plugins/b'] })
      return { marketplaceName: 'org-mp', installedRoot: '/x', alreadyAdded: true }
    })
    const result = await service.add('/p', {
      source: 'git@github.com:org/mp',
      refName: 'main',
      sparsePaths: ['plugins/a', 'plugins/b'],
    })
    expect(result.alreadyAdded).toBe(true)
  })

  it('add() rejects empty source without calling the server', async () => {
    const request = vi.fn()
    const service = makeService(request as never)
    await expect(service.add('/p', { source: '   ' })).rejects.toThrow(/empty/)
    expect(request).not.toHaveBeenCalled()
  })

  it('remove() calls marketplace/remove with the trimmed name', async () => {
    const service = makeService(async (method, params) => {
      expect(method).toBe('marketplace/remove')
      expect(params).toEqual({ marketplaceName: 'openai/codex-plugins' })
      return {}
    })
    await service.remove('/p', '  openai/codex-plugins  ')
  })

  it('upgrade() omits marketplaceName when not provided (upgrade all)', async () => {
    const service = makeService(async (method, params) => {
      expect(method).toBe('marketplace/upgrade')
      expect(params).toEqual({})
      return { selectedMarketplaces: ['a', 'b'], upgradedRoots: ['/r1', '/r2'], errors: [] }
    })
    const result = await service.upgrade('/p')
    expect(result.selectedMarketplaces).toEqual(['a', 'b'])
    expect(result.upgradedRoots).toEqual(['/r1', '/r2'])
    expect(result.errors).toEqual([])
  })

  it('upgrade() maps per-marketplace errors into structured CodexMarketplaceUpgradeError entries', async () => {
    const service = makeService(async () => ({
      selectedMarketplaces: ['a'],
      upgradedRoots: [],
      errors: [{ marketplaceName: 'a', message: 'git fetch failed' }, null, { name: 'b', error: 'network timeout' }],
    }))
    const result = await service.upgrade('/p', 'a')
    expect(result.errors).toEqual([
      { marketplaceName: 'a', message: 'git fetch failed' },
      { marketplaceName: 'b', message: 'network timeout' },
    ])
  })
})
