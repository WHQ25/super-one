/** @vitest-environment jsdom */

/**
 * Regression: a custom platform has no `BRANDS` entry, so its site favicon is the
 * only mark it can render. The provider list built its options from brand + name
 * and dropped `platform.icon`, leaving every custom provider on a generic globe
 * in the model selector (and, through the same helper, in "Powered by").
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, cleanup, act, waitFor } from '@testing-library/react'
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
  return { FAVICON, CUSTOM_PLATFORM, CREDENTIAL, session: { apiProviderId: null as string | null }, projectPath: '/project' }
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
  const session = fixtures.session
  const actions = { setSessionApiProviderId: vi.fn() }
  return {
    useActiveSession: (selector: (s: typeof session) => unknown) => selector(session),
    useChatStore: (selector: (s: { activeProject: string }) => unknown) => selector({
      get activeProject() { return fixtures.projectPath },
      ...actions,
    }),
    useScopedSessionActions: () => actions,
  }
})

import { useSelectorProviders } from './useSelectorProviders'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fixtures.session.apiProviderId = null
  fixtures.projectPath = '/project'
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

describe('Claude account provider choices', () => {
  it('uses the sole managed domain and updates the default without overriding an explicit session choice', async () => {
    const account = (dir: string) => ({ credentialDir: dir, loggedIn: true, isDefault: true, email: `${dir.slice(-1)}@example.test`, identityKey: `${dir}|org`, orgId: 'org', orgName: 'Personal', subscriptionType: 'max', projectsDirectory: null })
    let accounts = [account('/accounts/b')]
    vi.stubGlobal('app', { claudeListAccounts: vi.fn(async () => accounts) })
    const { result, rerender } = renderHook(() => useSelectorProviders('claude'))
    await waitFor(() => expect(result.current.selectedProviderId).toBe('claude-account:/accounts/b'))
    expect(result.current.providers[0]).toMatchObject({ id: 'claude-account:/accounts/b', keyName: 'b@example.test' })
    accounts = [account('/accounts/c')]
    await act(async () => { window.dispatchEvent(new Event('claude-accounts-changed')) })
    await waitFor(() => expect(result.current.selectedProviderId).toBe('claude-account:/accounts/c'))
    fixtures.session.apiProviderId = 'claude-account:/accounts/b'; rerender()
    expect(result.current.selectedProviderId).toBe('claude-account:/accounts/b')
  })

  it('lists the remote desktop\'s Claude and ChatGPT accounts while that project is open', async () => {
    fixtures.projectPath = 'remote:desk:/work'
    const localAccounts = vi.fn(async () => [{ credentialDir: '/local', loggedIn: true, isDefault: true, email: 'local@example.test', identityKey: 'local|org', orgId: 'org', orgName: 'Local', subscriptionType: 'max', projectsDirectory: null }])
    const remoteClaude = vi.fn(async () => [{ credentialDir: '/remote/a', loggedIn: true, isDefault: true, email: 'remote@example.test', identityKey: 'remote|org', orgId: 'org', orgName: 'Remote', subscriptionType: 'max', projectsDirectory: null }])
    const codexListAccounts = vi.fn(async () => [{ id: 'work', signedIn: true, isDefault: true, email: 'gpt@remote.test', planType: 'Plus' }])
    vi.stubGlobal('app', { claudeListAccounts: localAccounts, codexListAccounts })
    vi.stubGlobal('environment', { listRemoteClaudeAccounts: remoteClaude })

    const claude = renderHook(() => useSelectorProviders('claude'))
    await waitFor(() => expect(claude.result.current.selectedProviderId).toBe('claude-account:/remote/a'))
    expect(claude.result.current.providers[0]).toMatchObject({ keyName: 'remote@example.test' })
    expect(localAccounts).not.toHaveBeenCalled()
    expect(remoteClaude).toHaveBeenCalledWith('desk', false)
    claude.unmount()

    const codex = renderHook(() => useSelectorProviders('codex'))
    await waitFor(() => expect(codex.result.current.providers[0]).toMatchObject({ id: 'codex-account:work', keyName: expect.stringContaining('gpt@remote.test') }))
    expect(codexListAccounts).toHaveBeenCalledWith('remote:desk:/work')
  })
})
