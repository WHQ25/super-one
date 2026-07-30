/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const getAppSettings = vi.fn()
const saveAppSettings = vi.fn()
const openComputerUsePermissions = vi.fn()
const recheckComputerUsePermissions = vi.fn()
const listComputerUseRunningApps = vi.fn()
const startDrag = vi.fn()
const onComputerUsePermissionStatus = vi.fn(() => () => {})

Object.defineProperty(window, 'app', {
  configurable: true,
  value: {
    getAppSettings,
    saveAppSettings,
    openComputerUsePermissions,
    recheckComputerUsePermissions,
    listComputerUseRunningApps,
    startDrag,
    onComputerUsePermissionStatus,
  },
})

const { ComputerUseSettingsPage } = await import('./ComputerUseSettingsPage')

let currentSettings: ReturnType<typeof settings>

function settings(computerUseEnabled: boolean) {
  return {
    computerUseEnabled,
    computerUseAllowAllApps: false,
    computerUseAlwaysAllowApps: [],
  }
}

describe('ComputerUseSettingsPage permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentSettings = settings(false)
    getAppSettings.mockImplementation(async () => currentSettings)
    saveAppSettings.mockImplementation(async (patch: Partial<typeof currentSettings>) => {
      currentSettings = { ...currentSettings, ...patch }
      return currentSettings
    })
    openComputerUsePermissions.mockResolvedValue({
      requested: false,
      accessibility: 'missing',
      screenRecording: 'missing',
      helperName: 'SuperOne Dev Computer Use',
      helperBundleId: 'com.superone.computer-use.dev',
      helperPath: '/Applications/SuperOne Dev Computer Use.app',
    })
    recheckComputerUsePermissions.mockResolvedValue({
      requested: false,
      accessibility: 'granted',
      screenRecording: 'granted',
      helperName: 'SuperOne Dev Computer Use',
      helperBundleId: 'com.superone.computer-use.dev',
      helperPath: '/Applications/SuperOne Dev Computer Use.app',
      reason: 'already_granted',
    })
    listComputerUseRunningApps.mockResolvedValue([])
  })

  it('checks permission status once without requesting on mount', async () => {
    render(<ComputerUseSettingsPage />)

    await waitFor(() => {
      expect(openComputerUsePermissions).toHaveBeenCalledTimes(1)
    })
    expect(openComputerUsePermissions).toHaveBeenCalledWith(false)
    expect(screen.getByText('SuperOne Dev Computer Use')).toBeInTheDocument()
    expect(screen.getByText('com.superone.computer-use.dev')).toBeInTheDocument()
    expect(screen.getByText('/Applications/SuperOne Dev Computer Use.app')).toBeInTheDocument()
  })

  it('opens guided float when Computer Use is enabled and grants are missing', async () => {
    render(<ComputerUseSettingsPage />)
    await waitFor(() => expect(openComputerUsePermissions).toHaveBeenCalledWith(false))
    openComputerUsePermissions.mockClear()

    fireEvent.click(screen.getAllByRole('switch')[0])

    await waitFor(() => {
      expect(saveAppSettings).toHaveBeenCalledWith({ computerUseEnabled: true })
      expect(openComputerUsePermissions).toHaveBeenCalledWith('guided')
    })
  })

  it('does not re-request when permissions are already granted on enable', async () => {
    openComputerUsePermissions.mockResolvedValue({
      requested: false,
      accessibility: 'granted',
      screenRecording: 'granted',
      reason: 'already_granted',
    })
    render(<ComputerUseSettingsPage />)
    await waitFor(() => {
      const grantedBadges = screen.getAllByText('settings.computerUse.permissions.buttonGranted')
      expect(grantedBadges).toHaveLength(2)
      // Granted is a status badge, not an actionable button
      expect(screen.queryByRole('button', {
        name: 'settings.computerUse.permissions.buttonGranted',
      })).toBeNull()
    })
    openComputerUsePermissions.mockClear()

    fireEvent.click(screen.getAllByRole('switch')[0])

    await waitFor(() => {
      expect(saveAppSettings).toHaveBeenCalledWith({ computerUseEnabled: true })
    })
    expect(openComputerUsePermissions).not.toHaveBeenCalled()
  })

  it('requests accessibility and screen recording independently', async () => {
    render(<ComputerUseSettingsPage />)
    await waitFor(() => expect(openComputerUsePermissions).toHaveBeenCalledWith(false))
    openComputerUsePermissions.mockClear()

    fireEvent.click(screen.getByRole('button', {
      name: 'settings.computerUse.permissions.requestAccessibility',
    }))
    await waitFor(() => expect(openComputerUsePermissions).toHaveBeenCalledWith('accessibility'))

    openComputerUsePermissions.mockClear()
    fireEvent.click(screen.getByRole('button', {
      name: 'settings.computerUse.permissions.requestScreenRecording',
    }))
    await waitFor(() => expect(openComputerUsePermissions).toHaveBeenCalledWith('screenRecording'))
  })

  it('hides Always allow without turning the Allow all description red', async () => {
    currentSettings = settings(true)
    render(<ComputerUseSettingsPage />)
    await waitFor(() => expect(screen.getAllByRole('switch')[1]).toBeEnabled())

    const description = screen.getByText('settings.computerUse.allowAll.description')
    expect(description.className).toContain('text-muted-foreground')
    expect(description.className).not.toContain('text-destructive')

    fireEvent.click(screen.getAllByRole('switch')[1])

    await waitFor(() => {
      expect(saveAppSettings).toHaveBeenCalledWith({ computerUseAllowAllApps: true })
      expect(screen.queryByText('settings.computerUse.alwaysAllow.title')).toBeNull()
    })
  })
})
