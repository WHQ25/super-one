import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getNodeCodexModelCatalog,
  listCodexAppServerModels,
  resetNodeCodexModelCatalogForTests,
  type CodexCatalogAccounts,
} from './codex-model-catalog'

const dirs: string[] = []

afterEach(() => {
  resetNodeCodexModelCatalogForTests()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempBinary(): string {
  const dir = mkdtempSync(join(tmpdir(), 'codex-catalog-'))
  dirs.push(dir)
  const binaryPath = join(dir, 'codex')
  writeFileSync(binaryPath, '')
  return binaryPath
}

const sol = {
  id: 'gpt-5.5',
  model: 'gpt-5.5',
  displayName: 'GPT-5.5',
  description: 'Sol',
  isDefault: true,
  hidden: false,
  supportedReasoningEfforts: [
    { reasoningEffort: 'low', description: 'Low' },
    { reasoningEffort: 'high', description: 'High' },
  ],
  defaultReasoningEffort: 'high',
  serviceTiers: [{ id: 'fast', name: 'Fast', description: 'Faster' }],
  defaultServiceTier: 'default',
  multiAgentVersion: 'v2',
  upgradeInfo: { retirementAt: 1_800_000_000_000 },
}

describe('listCodexAppServerModels', () => {
  it('maps a page and follows the cursor', async () => {
    const request = vi.fn(async (_method: string, params?: Record<string, unknown>) => {
      if (!params?.cursor) {
        return {
          data: [sol, { id: 'hidden-model', model: 'hidden-model', hidden: true }],
          nextCursor: 'page-2',
        }
      }
      return {
        data: [{ id: 'gpt-5.4', model: 'gpt-5.4', displayName: 'GPT-5.4', description: '' }],
        nextCursor: null,
      }
    })

    const models = await listCodexAppServerModels(request)

    expect(models.map((model) => model.id)).toEqual(['gpt-5.5', 'gpt-5.4'])
    expect(models[0]).toMatchObject({
      name: 'GPT-5.5',
      description: 'Sol',
      isDefault: true,
      defaultReasoningEffort: 'high',
      supportedReasoningEfforts: [
        { value: 'low', description: 'Low' },
        { value: 'high', description: 'High' },
      ],
      serviceTiers: [{ id: 'fast', name: 'Fast', description: 'Faster' }],
      defaultServiceTier: 'default',
      multiAgentVersion: 'v2',
      retirementAt: 1_800_000_000_000,
    })
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1]?.[1]).toMatchObject({ cursor: 'page-2', limit: 100 })
  })

  it('marks the first row as default when the catalog does not', async () => {
    const models = await listCodexAppServerModels(async () => ({
      data: [{ model: 'o3', displayName: 'o3', description: '' }],
    }))
    expect(models[0]?.isDefault).toBe(true)
  })
})

describe('getNodeCodexModelCatalog', () => {
  it('does not cache an empty probe', async () => {
    let calls = 0
    const request = async () => {
      calls += 1
      return calls === 1
        ? { data: [] }
        : { data: [{ model: 'gpt-5.5', displayName: 'GPT-5.5', description: '', isDefault: true }] }
    }

    expect(await getNodeCodexModelCatalog({ request })).toEqual([])
    expect((await getNodeCodexModelCatalog({ request })).map((model) => model.id)).toEqual(['gpt-5.5'])
    expect((await getNodeCodexModelCatalog({ request })).map((model) => model.id)).toEqual(['gpt-5.5'])
    expect(calls).toBe(2)
  })

  it('does not ask model/list for a custom credential', async () => {
    const open = vi.fn()
    await expect(getNodeCodexModelCatalog({ apiProviderId: 'cred-custom', open })).resolves.toEqual([])
    expect(open).not.toHaveBeenCalled()
  })

  it('returns nothing when the Codex binary is missing', async () => {
    const open = vi.fn()
    const previous = process.env.SUPERONE_CODEX_BINARY
    delete process.env.SUPERONE_CODEX_BINARY
    try {
      const models = await getNodeCodexModelCatalog({
        binaryPath: '/no/such/codex-binary-for-catalog-test',
        open,
        accounts: {
          defaultProviderId: () => null,
          environment: (_id, base) => base,
          cliOverrides: () => [],
        },
      })
      expect(models).toEqual([])
      expect(open).not.toHaveBeenCalled()
    } finally {
      if (previous === undefined) delete process.env.SUPERONE_CODEX_BINARY
      else process.env.SUPERONE_CODEX_BINARY = previous
    }
  })

  it('returns nothing when the ChatGPT account is not signed in', async () => {
    const open = vi.fn()
    const accounts: CodexCatalogAccounts = {
      defaultProviderId: () => 'codex-account:cli',
      environment: () => {
        throw new Error('Please sign in to this Codex account before continuing.')
      },
      cliOverrides: () => [],
    }
    const models = await getNodeCodexModelCatalog({
      apiProviderId: 'codex-account:cli',
      binaryPath: tempBinary(),
      open,
      accounts,
    })
    expect(models).toEqual([])
    expect(open).not.toHaveBeenCalled()
  })

  it('launches model/list with the ChatGPT account environment', async () => {
    const binaryPath = tempBinary()
    const request = vi.fn(async () => ({
      data: [{ model: 'gpt-5.5', displayName: 'GPT-5.5', description: '', isDefault: true }],
    }))
    const open = vi.fn(async () => ({ request, close: async () => {} }))
    const accounts: CodexCatalogAccounts = {
      defaultProviderId: () => null,
      environment: (providerId, base) => ({
        ...base,
        CODEX_HOME: '/accounts/cli',
        SUPERONE_CODEX_ACCOUNT_PROVIDER: providerId,
      }),
      cliOverrides: () => ['-c', 'model_provider="openai"'],
    }

    const models = await getNodeCodexModelCatalog({
      apiProviderId: 'codex-account:cli',
      binaryPath,
      open,
      accounts,
    })

    expect(models.map((model) => model.id)).toEqual(['gpt-5.5'])
    expect(open).toHaveBeenCalledWith(expect.objectContaining({
      binaryPath,
      cliArgs: ['-c', 'model_provider="openai"'],
      env: expect.objectContaining({ CODEX_HOME: '/accounts/cli' }),
    }))
    expect(request).toHaveBeenCalledWith('model/list', { limit: 100 })
  })
})
