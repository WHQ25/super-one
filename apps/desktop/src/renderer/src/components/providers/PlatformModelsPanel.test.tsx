/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_PLATFORMS, findPlan, findPlatform } from '@superone/shared/platform-registry'
import type { Credential, Platform } from '@superone/shared/platform-registry'
import type { CatalogModel, ModelCatalog } from '@superone/shared/model-catalog-types'

const chat = (providerId: string, id: string): CatalogModel => ({
  id,
  name: id,
  providerId,
  inputModalities: ['text'],
  outputModalities: ['text'],
  reasoning: true,
  toolCall: true,
  attachment: false,
})

const catalog: ModelCatalog = {
  generatedAt: '',
  source: 'cache',
  providers: [
    { id: 'xiaomi', name: 'Xiaomi', npm: '@ai-sdk/anthropic', doc: '', env: [], models: ['mimo-v2.5-pro', 'mimo-v2.6-pro', 'mimo-v2.6-flash'].map((id) => chat('xiaomi', id)) },
    { id: 'moonshotai', name: 'Moonshot', npm: '@ai-sdk/anthropic', doc: '', env: [], models: ['kimi-k2.6', 'k3'].map((id) => chat('moonshotai', id)) },
  ],
}

const updateCredential = vi.fn()
let credentials: Credential[] = []

vi.mock('@/hooks/useModelCatalog', () => ({
  useModelCatalog: () => ({ catalog, loading: false, refreshing: false, refresh: vi.fn() }),
}))
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (s: unknown) => unknown) =>
    select({ credentials, updateCredential, updateCustomPlatform: vi.fn() }),
}))

const { PlatformModelsPanel } = await import('./PlatformModelsPanel')

function credential(platformId: string, planId: string, extra: Partial<Credential> = {}): Credential {
  return { id: 'c1', platformId, planId, name: 'Key', secret: '***abcdef', notes: '', sortOrder: 0, ...extra }
}

function renderPanel(platform: Platform, planId: string, cred: Credential) {
  credentials = [cred]
  render(<PlatformModelsPanel platform={platform} plan={findPlan(platform, planId)!} selectedKeyId={cred.id} />)
}

function switchFor(modelId: string): HTMLElement {
  // The name and the id badge both read `modelId` when the catalog has no display name.
  let el: HTMLElement | null = screen.getAllByText(modelId)[0]
  while (el && !el.querySelector('[role="switch"]')) el = el.parentElement
  return el!.querySelector('[role="switch"]') as HTMLElement
}

afterEach(() => {
  cleanup()
  updateCredential.mockReset()
})

describe('PlatformModelsPanel', () => {
  it('enables a catalog model on the Xiaomi API plan (issue #66)', () => {
    const xiaomi = findPlatform(BUILTIN_PLATFORMS, 'xiaomi')!
    renderPanel(xiaomi, 'api', credential('xiaomi', 'api'))

    fireEvent.click(switchFor('mimo-v2.6-flash'))

    expect(updateCredential).toHaveBeenCalledWith('c1', {
      overrides: { anthropic: { models: [{ id: 'mimo-v2.6-flash', name: 'mimo-v2.6-flash', tasks: ['chat'] }] } },
    })
  })

  it('lists a curated plan pool rather than the whole catalog provider', () => {
    const kimi = findPlatform(BUILTIN_PLATFORMS, 'kimi')!
    renderPanel(kimi, 'plus', credential('kimi', 'plus'))

    // Curated ids render even when the catalog has no entry; catalog-only ids the plan cannot serve do not.
    expect(screen.getAllByText('kimi-for-coding').length).toBeGreaterThan(0)
    expect(screen.queryByText('kimi-k2.6')).toBeNull()

    fireEvent.click(switchFor('kimi-for-coding'))
    const [, patch] = updateCredential.mock.calls[0]
    expect(Object.values(patch.overrides).map((o) => (o as { models: { id: string }[] }).models.map((m) => m.id)))
      .toEqual([['kimi-for-coding'], ['kimi-for-coding']])
  })

  it('adds a catalog model to a custom key without dropping models it already enabled', () => {
    const platform: Platform = {
      id: 'custom:relay',
      brand: 'custom',
      name: 'Relay',
      catalogProviderId: 'xiaomi',
      plans: [{ id: 'api', name: 'API', auth: 'api-key', baseUrl: 'https://relay.example', endpoints: [] }],
    }
    const endpoints = [{ id: 'openai', protocols: ['openai-chat' as const], models: [{ id: 'mimo-v2.5-pro', tasks: ['chat' as const] }] }]
    renderPanel(platform, 'api', credential('custom:relay', 'api', { endpoints }))

    fireEvent.click(switchFor('mimo-v2.6-pro'))

    const [, patch] = updateCredential.mock.calls[0]
    expect(patch.endpoints[0].models.map((m: { id: string }) => m.id)).toEqual(['mimo-v2.5-pro', 'mimo-v2.6-pro'])
  })
})
