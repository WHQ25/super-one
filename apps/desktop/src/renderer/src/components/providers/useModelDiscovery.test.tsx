/** @vitest-environment jsdom */
import { renderHook, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Credential, Plan, Platform, ServiceEndpoint } from '@superone/shared/platform-registry'
import { useModelDiscovery } from './useModelDiscovery'

/** vitest.setup.ts installs window.app as a Proxy whose get trap ignores the property name and
 * always returns a noop — plain assignment to one property is invisible on read. Replace the whole
 * object with a Proxy that actually looks up overrides, falling back to noop for anything else. */
function stubApp(overrides: Record<string, unknown>): void {
  const noop = () => Promise.resolve(undefined)
  ;(window as unknown as { app: unknown }).app = new Proxy(overrides, {
    get: (target, prop) => (prop in target ? target[prop as string] : noop),
  })
}

function makePlatform(endpoints: ServiceEndpoint[]): { platform: Platform; plan: Plan } {
  const plan: Plan = { id: 'api', name: 'API', auth: 'api-key', endpoints }
  const platform: Platform = { id: 'custom:test', brand: 'custom', name: 'Test Relay', plans: [plan] }
  return { platform, plan }
}

function makeCredential(overrides?: Record<string, { models?: { id: string; tasks?: string[] }[] }>): Credential {
  return {
    id: 'cred-1',
    platformId: 'custom:test',
    planId: 'api',
    name: 'Key',
    secret: '***abcdef',
    overrides: overrides as Credential['overrides'],
    notes: '',
    sortOrder: 0,
  }
}

describe('useModelDiscovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('populates discovered models and marks state done on success', async () => {
    const openaiEp: ServiceEndpoint = { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat', 'openai-images'] }
    const { platform, plan } = makePlatform([openaiEp])
    const credential = makeCredential()
    stubApp({
      discoverProviderModels: vi.fn(async () => ({
        models: [{ id: 'gpt-5', tasks: ['chat'], byFamily: { openai: ['chat'] } }],
        truncated: false,
        sources: { pricing: 'ok', modelsList: 'ok' },
      })),
    })

    const { result } = renderHook(() =>
      useModelDiscovery({ platform, plan, credential, updateCredential: vi.fn(), updateCustomPlatform: vi.fn() }),
    )

    await act(async () => {
      await result.current.discover()
    })

    expect(result.current.discovered).toEqual([{ id: 'gpt-5', tasks: ['chat'], byFamily: { openai: ['chat'] } }])
    expect(result.current.state).toEqual({ status: 'done', truncated: false })
  })

  it('sets error state when the IPC call rejects', async () => {
    const openaiEp: ServiceEndpoint = { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat'] }
    const { platform, plan } = makePlatform([openaiEp])
    const credential = makeCredential()
    stubApp({
      discoverProviderModels: vi.fn(async () => {
        throw new Error('network down')
      }),
    })

    const { result } = renderHook(() =>
      useModelDiscovery({ platform, plan, credential, updateCredential: vi.fn(), updateCustomPlatform: vi.fn() }),
    )

    await act(async () => {
      await result.current.discover()
    })

    expect(result.current.state).toEqual({ status: 'error', message: 'network down' })
  })

  it('writes enabled models onto credential.endpoints for custom platforms (not the plan)', async () => {
    const openaiEp: ServiceEndpoint = { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat'] }
    const { platform, plan } = makePlatform([openaiEp])
    const credential = makeCredential()
    const updateCredential = vi.fn()
    const updateCustomPlatform = vi.fn()

    const { result } = renderHook(() =>
      useModelDiscovery({ platform, plan, credential, updateCredential, updateCustomPlatform }),
    )

    await act(async () => {
      await result.current.enableModels([{ id: 'gpt-5', tasks: ['chat'], byFamily: { openai: ['chat'] } }])
    })

    expect(updateCustomPlatform).not.toHaveBeenCalled()
    expect(updateCredential).toHaveBeenCalledWith('cred-1', {
      endpoints: [
        {
          id: 'openai',
          baseUrl: 'https://relay.com/v1',
          protocols: ['openai-chat'],
          models: [{ id: 'gpt-5', name: undefined, tasks: ['chat'] }],
        },
      ],
      overrides: {},
    })
  })

  it('widens protocols on the key endpoints when a discovered task is unserved', async () => {
    const openaiEp: ServiceEndpoint = { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat'] }
    const { platform, plan } = makePlatform([openaiEp])
    const credential = makeCredential()
    const updateCredential = vi.fn()
    const updateCustomPlatform = vi.fn()

    const { result } = renderHook(() =>
      useModelDiscovery({ platform, plan, credential, updateCredential, updateCustomPlatform }),
    )

    await act(async () => {
      await result.current.enableModels([{ id: 'gpt-image-1', tasks: ['image'], byFamily: { openai: ['image'] } }])
    })

    expect(updateCustomPlatform).not.toHaveBeenCalled()
    const patch = updateCredential.mock.calls[0][1]
    expect(patch.endpoints[0].protocols).toEqual(expect.arrayContaining(['openai-chat', 'openai-images']))
    expect(patch.endpoints[0].models).toEqual([{ id: 'gpt-image-1', name: undefined, tasks: ['image'] }])
  })

  it('synthesizes missing family endpoints on the key when enabling anthropic/gemini models', async () => {
    const openaiEp: ServiceEndpoint = { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat'] }
    const { platform, plan } = makePlatform([openaiEp])
    const credential = makeCredential()
    const updateCredential = vi.fn()
    const updateCustomPlatform = vi.fn()

    const { result } = renderHook(() =>
      useModelDiscovery({ platform, plan, credential, updateCredential, updateCustomPlatform }),
    )

    await act(async () => {
      await result.current.enableModels([
        { id: 'claude-opus', tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
        { id: 'gemini-pro', tasks: ['chat'], byFamily: { google: ['chat'] } },
      ])
    })

    expect(updateCustomPlatform).not.toHaveBeenCalled()
    const patch = updateCredential.mock.calls[0][1]
    const ids = patch.endpoints.map((e: ServiceEndpoint) => e.id).sort()
    expect(ids).toEqual(['anthropic', 'google', 'openai'])
    expect(patch.endpoints.find((e: ServiceEndpoint) => e.id === 'anthropic')?.models).toEqual([
      { id: 'claude-opus', name: undefined, tasks: ['chat'] },
    ])
    expect(patch.endpoints.find((e: ServiceEndpoint) => e.id === 'google')?.models).toEqual([
      { id: 'gemini-pro', name: undefined, tasks: ['chat'] },
    ])
  })

  it('can discover when the plan has only an anthropic endpoint (synthesized openai probe)', async () => {
    const anthropicEp: ServiceEndpoint = { id: 'anthropic', baseUrl: 'https://relay.com', protocols: ['anthropic-messages'] }
    const { platform, plan } = makePlatform([anthropicEp])
    const credential = makeCredential()
    const discoverProviderModels = vi.fn(async () => ({
      models: [{ id: 'claude-opus', tasks: ['chat'], byFamily: { anthropic: ['chat'] } }],
      truncated: false,
      sources: { pricing: 'unavailable', modelsList: 'ok' },
    }))
    stubApp({ discoverProviderModels })

    const { result } = renderHook(() =>
      useModelDiscovery({ platform, plan, credential, updateCredential: vi.fn(), updateCustomPlatform: vi.fn() }),
    )

    await act(async () => {
      await result.current.discover()
    })

    expect(discoverProviderModels).toHaveBeenCalledWith({
      apiKey: '',
      credentialId: 'cred-1',
      endpoint: { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat'] },
    })
    expect(result.current.discovered).toEqual([
      { id: 'claude-opus', tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
    ])
  })
})
