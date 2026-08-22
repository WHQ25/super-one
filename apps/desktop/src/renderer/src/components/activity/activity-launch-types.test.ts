/** @vitest-environment jsdom */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  openDeviceTab: vi.fn(),
  openTrajectoryTab: vi.fn(),
  chatState: {
    activeProject: '/repo',
    projectSessions: {
      '/repo': {
        _activeSessionId: 's1',
        _sessions: { s1: { sessionProvider: 'dsh', preferredProvider: 'claude' } },
      },
    },
  } as Record<string, unknown>,
}))

vi.mock('./activity-panel-api', () => ({
  openBrowserTab: vi.fn(),
  openDeviceTab: hoisted.openDeviceTab,
  openTerminalTab: vi.fn(),
  openTrajectoryTab: hoisted.openTrajectoryTab,
}))

vi.mock('@/stores/app', () => ({
  useAppStore: Object.assign(
    (selector: (s: { currentFolder: string }) => unknown) => selector({ currentFolder: '/repo' }),
    { getState: () => ({ currentFolder: '/repo' }) },
  ),
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: Object.assign(
    (selector: (s: typeof hoisted.chatState) => unknown) => selector(hoisted.chatState),
    { getState: () => hoisted.chatState },
  ),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

/** Point the active session at one harness. */
function activeHarness(provider: string | null) {
  hoisted.chatState.projectSessions = {
    '/repo': {
      _activeSessionId: provider === null ? null : 's1',
      _sessions: provider === null
        ? {}
        : { s1: { sessionProvider: provider, preferredProvider: 'claude' } },
    },
  }
}

async function launchIds() {
  const { useActivityLaunchTypes } = await import('./activity-launch-types')
  const { result } = renderHook(() => useActivityLaunchTypes())
  return result.current.map((type) => type.id)
}

beforeEach(() => {
  Object.defineProperty(window, 'app', {
    configurable: true,
    value: { platform: 'darwin' },
  })
  hoisted.openDeviceTab.mockReset()
  hoisted.openTrajectoryTab.mockReset()
  activeHarness('dsh')
})

describe('activity launcher entries', () => {
  it('offers Trajectory on a dsh session', async () => {
    expect(await launchIds()).toEqual([
      'browser', 'terminal', 'ios-simulator', 'android-device', 'trajectory',
    ])
  })

  it.each(['claude', 'codex', 'acp', 'opencode', 'cursor'])(
    'hides Trajectory entirely on a %s session',
    async (provider) => {
      activeHarness(provider)

      // Absent, not disabled: a greyed-out row would imply the user could turn
      // it on, and no other harness writes a dsh log to project.
      expect(await launchIds()).toEqual(['browser', 'terminal', 'ios-simulator', 'android-device'])
    },
  )

  it('hides Trajectory when no session is active', async () => {
    activeHarness(null)

    expect(await launchIds()).toEqual(['browser', 'terminal'])
  })

  it('opens the active dsh session when Trajectory is picked', async () => {
    const { useActivityLaunchTypes } = await import('./activity-launch-types')
    const { result } = renderHook(() => useActivityLaunchTypes())

    result.current.find((type) => type.id === 'trajectory')?.onOpen()

    expect(hoisted.openTrajectoryTab).toHaveBeenCalledWith('s1', 'trajectory.title')
  })

  it('opens iOS Simulator for the active session', async () => {
    const { useActivityLaunchTypes } = await import('./activity-launch-types')
    const { result } = renderHook(() => useActivityLaunchTypes())

    result.current.find((type) => type.id === 'ios-simulator')?.onOpen()

    expect(hoisted.openDeviceTab).toHaveBeenCalledWith('s1', 'activity.device.title')
  })

  it('opens Android for the active session', async () => {
    const { useActivityLaunchTypes } = await import('./activity-launch-types')
    const { result } = renderHook(() => useActivityLaunchTypes())

    result.current.find((type) => type.id === 'android-device')?.onOpen()

    expect(hoisted.openDeviceTab).toHaveBeenCalledWith('s1', 'activity.device.title')
  })

  it('hides iOS Simulator outside macOS', async () => {
    Object.defineProperty(window, 'app', {
      configurable: true,
      value: { platform: 'linux' },
    })
    vi.resetModules()

    expect(await launchIds()).toEqual(['browser', 'terminal', 'android-device', 'trajectory'])
  })
})
