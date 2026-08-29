/** @vitest-environment jsdom */

/**
 * Regression: a custom platform has no `BRANDS` entry, so its site favicon is the
 * only mark it can render. The provider list built its options from brand + name
 * and dropped `platform.icon`, leaving every custom provider on a generic globe
 * in the model selector (and, through the same helper, in "Powered by").
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import type { Credential, Platform } from '@superone/shared/platform-registry'

// Hoisted: `vi.mock` factories run before module-level consts are initialized.
const fixtures = vi.hoisted(() => {
  const FAVICON = 'data:image/png;base64,iVBORw0KGgo='
  const CUSTOM_PLATFORM = {
    id: 'custom:1',
    brand: 'custom',
    name: 'AIYun Router',
    icon: FAVICON,
    plans: [
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        endpoints: [
          { id: 'anthropic', baseUrl: 'https://aiyun.example.com', protocols: ['anthropic-messages'] },
        ],
      },
    ],
  }
  const CREDENTIAL = {
    id: 'cred-1',
    platformId: CUSTOM_PLATFORM.id,
    planId: 'api',
    name: 'personal key',
    secret: '',
    notes: '',
    sortOrder: 0,
  }
  return { FAVICON, CUSTOM_PLATFORM, CREDENTIAL }
})

const CUSTOM_PLATFORM = fixtures.CUSTOM_PLATFORM as Platform
const CREDENTIAL = fixtures.CREDENTIAL as Credential

vi.mock('@/stores/settings', () => {
  const state = {
    platforms: [fixtures.CUSTOM_PLATFORM],
    credentials: [fixtures.CREDENTIAL],
    bindings: [],
    providerScope: 'local',
    fetchProviderData: vi.fn().mockResolvedValue(undefined),
    setProviderScope: vi.fn(),
  }
  const useSettingsStore = (selector: (s: typeof state) => unknown) => selector(state)
  useSettingsStore.getState = () => state
  return { useSettingsStore }
})

vi.mock('@/stores/app', () => {
  const state = {
    experimentalClaudeOpenAiChatEnabled: false,
    selectedHostConnectionId: 'local',
    navigateTo: vi.fn(),
    setSettingsTab: vi.fn(),
  }
  const useAppStore = (selector: (s: typeof state) => unknown) => selector(state)
  useAppStore.getState = () => state
  return { useAppStore }
})

vi.mock('@/stores/chat', () => {
  const session = { apiProviderId: null }
  const chat = { setSessionApiProviderId: vi.fn() }
  return {
    useActiveSession: (selector: (s: typeof session) => unknown) => selector(session),
    useChatStore: (selector: (s: typeof chat) => unknown) => selector(chat),
    useScopedSessionActions: () => chat,
  }
})

import { useSelectorProviders } from './useSelectorProviders'

afterEach(() => {
  cleanup()
})

describe('model-selector provider options for a custom platform', () => {
  it('carries the platform favicon so the row is not left on a generic globe', () => {
    const { result } = renderHook(() => useSelectorProviders('claude'))

    const option = result.current.providers.find((p) => p.id === CREDENTIAL.id)
    expect(option).toMatchObject({
      name: CUSTOM_PLATFORM.name,
      icon: fixtures.FAVICON,
      keyName: CREDENTIAL.name,
    })
  })
})
