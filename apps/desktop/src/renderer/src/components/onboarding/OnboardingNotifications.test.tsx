/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_NOTIFICATION_SETTINGS } from '@superone/shared/notifications'
import { OnboardingNotifications } from './OnboardingNotifications'

function stub(options: { platform?: string; primedAt?: number | null } = {}) {
  const saveAppSettings = vi.fn().mockResolvedValue({})
  const primeNotificationPermission = vi.fn().mockResolvedValue(true)
  Object.assign(window.app, {
    platform: options.platform ?? 'darwin',
    getAppSettings: vi.fn().mockResolvedValue({
      notifications: DEFAULT_NOTIFICATION_SETTINGS,
      notificationsPrimedAt: options.primedAt ?? null,
    }),
    saveAppSettings,
    primeNotificationPermission,
  })
  return { saveAppSettings, primeNotificationPermission }
}

beforeEach(() => {
  stub()
})

describe('onboarding notification setup', () => {
  it('starts off, so there is something for the user to actually turn on', async () => {
    // Bound to notifications.enabled it would render on -- that preference
    // defaults true -- and the click that spends the macOS prompt would never
    // happen.
    render(<OnboardingNotifications />)
    const toggle = await screen.findByRole('switch')
    expect(toggle).not.toBeChecked()
  })

  it('posts the first notification when the user turns it on', async () => {
    const { saveAppSettings, primeNotificationPermission } = stub()
    render(<OnboardingNotifications />)

    await userEvent.click(await screen.findByRole('switch'))

    expect(primeNotificationPermission).toHaveBeenCalledOnce()
    expect(saveAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        notifications: { enabled: true },
        notificationsPrimedAt: expect.any(Number),
      }),
    )
    // The prompt steals focus, so the user needs to know what they are looking at.
    expect(screen.getByText(/choose allow/i)).toBeInTheDocument()
  })

  it('does not ask twice when onboarding is revisited', async () => {
    const { primeNotificationPermission } = stub({ primedAt: 1_600_000_000_000 })
    render(<OnboardingNotifications />)

    expect(await screen.findByRole('switch')).toBeChecked()
    expect(primeNotificationPermission).not.toHaveBeenCalled()
  })

  it('turns the preference off without leaving a primed flag behind', async () => {
    const { saveAppSettings, primeNotificationPermission } = stub({ primedAt: 1_600_000_000_000 })
    render(<OnboardingNotifications />)

    await userEvent.click(await screen.findByRole('switch'))

    expect(primeNotificationPermission).not.toHaveBeenCalled()
    expect(saveAppSettings).toHaveBeenCalledWith({
      notifications: { enabled: false },
      notificationsPrimedAt: null,
    })
  })

  it('renders nothing off macOS, where there is no prompt to spend', () => {
    stub({ platform: 'win32' })
    const { container } = render(<OnboardingNotifications />)
    expect(container).toBeEmptyDOMElement()
  })
})
