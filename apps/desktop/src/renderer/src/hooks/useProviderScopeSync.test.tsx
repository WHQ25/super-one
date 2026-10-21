// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useProviderScopeSync } from './useProviderScopeSync'

afterEach(cleanup)

describe('useProviderScopeSync', () => {
  it('settles while the sidebar host has switched but the open project has not followed yet', () => {
    let writes = 0
    useSettingsStore.setState({
      providerScope: 'local',
      setProviderScope: (scope: string) => { writes += 1; useSettingsStore.setState({ providerScope: scope }) },
    } as never)
    useAppStore.setState({ selectedHostConnectionId: 'desktop-2' } as never)
    useChatStore.setState({ activeProject: '/Users/dev/app' } as never)

    // Model selector and chat suggestions mount together in the composer.
    renderHook(() => { useProviderScopeSync(); useProviderScopeSync() })
    expect(useSettingsStore.getState().providerScope).toBe('local')
    expect(writes).toBe(0)

    act(() => { useChatStore.setState({ activeProject: null } as never) })
    expect(useSettingsStore.getState().providerScope).toBe('desktop-2')
    const settledWrites = writes

    act(() => { useChatStore.setState({ activeProject: 'remote:desktop-2:/work/app' } as never) })
    expect(useSettingsStore.getState().providerScope).toBe('desktop-2')
    expect(writes).toBe(settledWrites)
  })
})
