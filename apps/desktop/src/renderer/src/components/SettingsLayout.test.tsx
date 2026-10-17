/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { SettingsLayout } from './SettingsLayout'

vi.mock('@/lib/analytics', () => ({ shutdownAnalytics: vi.fn(), startAnalytics: vi.fn() }))
vi.mock('./ProvidersPage', () => ({ ProvidersPage: () => null }))
vi.mock('./RemotePage', () => ({ RemotePage: () => null }))
vi.mock('./AppsSettingsPage', () => ({ AppsSettingsPage: () => null }))
vi.mock('./AppearancePage', () => ({ AppearancePage: () => null }))
vi.mock('./BrowserSettingsPage', () => ({ BrowserSettingsPage: () => null }))
vi.mock('./ComputerUseSettingsPage', () => ({ ComputerUseSettingsPage: () => null }))
vi.mock('./HarnessesSettingsPage', () => ({ HarnessesSettingsPage: () => null }))
vi.mock('./TerminalSettingsPage', () => ({ TerminalSettingsPage: () => null }))
vi.mock('./AgentProfilesPage', () => ({ AgentProfilesPage: () => <div>Profile Manager Content</div> }))
vi.mock('./providers/DefaultProviderRow', () => ({ DefaultProviderRow: () => null }))
vi.mock('./settings/NotificationSettingsSection', () => ({ NotificationSettingsSection: () => null }))
vi.mock('./settings/SessionStorageSection', () => ({ SessionStorageSection: () => null }))
vi.mock('./settings/JevFastLoopSetting', () => ({ JevFastLoopSetting: () => null }))

beforeEach(() => {
  useAppStore.setState({ settingsTab: 'agent-profiles', experimentalAgentProfilesEnabled: false })
  Object.assign(window.app, { getAppSettings: vi.fn().mockResolvedValue({ analyticsEnabled: true, powerMode: 'system' }), saveAppSettings: vi.fn() })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); Reflect.deleteProperty(window.app, 'getAppSettings'); Reflect.deleteProperty(window.app, 'saveAppSettings') })

describe('Agent Profile experimental settings', () => {
  it('hides the navigation and falls back to General for a stale Profile tab', async () => {
    render(<SettingsLayout />)
    await screen.findByRole('switch', { name: 'Agent Profiles' })
    expect(screen.queryByRole('button', { name: 'Agent Profiles' })).not.toBeInTheDocument()
    expect(screen.queryByText('Profile Manager Content')).not.toBeInTheDocument()
  })

  it('enables Profiles through the persisted switch and unmounts the manager when disabled', async () => {
    const save = vi.mocked(window.app.saveAppSettings).mockResolvedValue({ experimentalAgentProfilesEnabled: true } as never)
    render(<SettingsLayout />)
    const toggle = await screen.findByRole('switch', { name: 'Agent Profiles' })
    await waitFor(() => expect(toggle).not.toBeDisabled())
    fireEvent.click(toggle)
    await screen.findByText('Profile Manager Content')
    expect(save).toHaveBeenCalledWith({ experimentalAgentProfilesEnabled: true })
    expect(screen.getByRole('button', { name: 'Agent Profiles' })).toBeInTheDocument()
    act(() => useAppStore.setState({ experimentalAgentProfilesEnabled: false }))
    expect(screen.queryByText('Profile Manager Content')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agent Profiles' })).not.toBeInTheDocument()
  })

  it('keeps the feature off when saving the switch fails', async () => {
    vi.mocked(window.app.saveAppSettings).mockRejectedValue(new Error('Cannot save'))
    render(<SettingsLayout />)
    const toggle = await screen.findByRole('switch', { name: 'Agent Profiles' })
    await waitFor(() => expect(toggle).not.toBeDisabled())
    fireEvent.click(toggle)
    await waitFor(() => expect(window.app.saveAppSettings).toHaveBeenCalled())
    expect(useAppStore.getState().experimentalAgentProfilesEnabled).toBe(false)
    expect(screen.queryByRole('button', { name: 'Agent Profiles' })).not.toBeInTheDocument()
  })
})
