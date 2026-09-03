/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATION_KINDS } from '@superone/shared/notifications'
import { NotificationSettingsSection } from './NotificationSettingsSection'

function stubSettings(notifications: typeof DEFAULT_NOTIFICATION_SETTINGS): void {
  Object.assign(window.app, {
    getAppSettings: vi.fn().mockResolvedValue({ notifications }),
    saveAppSettings: vi.fn().mockResolvedValue({ notifications }),
  })
}

beforeEach(() => {
  stubSettings(DEFAULT_NOTIFICATION_SETTINGS)
})

describe('notification settings', () => {
  it('keeps the per-kind rows folded away until asked for', async () => {
    // The master switch is the decision nearly everyone makes; four extra
    // toggles beside it read as four more decisions to make.
    render(<NotificationSettingsSection />)
    await screen.findByText('Notify me about')
    expect(screen.queryByText('Tool permission requests')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /notify me about/i }))

    for (const label of ['Tool permission requests', 'Questions from the agent']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('summarises the selection so the folded row still says something', async () => {
    stubSettings({
      ...DEFAULT_NOTIFICATION_SETTINGS,
      kinds: { ...DEFAULT_NOTIFICATION_SETTINGS.kinds, plan: false },
    })
    render(<NotificationSettingsSection />)

    // Without this the collapsed row would hide the fact that anything was
    // ever customised.
    await screen.findByText(`${NOTIFICATION_KINDS.length - 1} of ${NOTIFICATION_KINDS.length} kinds`)
  })

  it('drops the per-kind section entirely when notifications are off', async () => {
    stubSettings({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: false })
    render(<NotificationSettingsSection />)

    await screen.findByText('Notify when a session needs you')
    // Rendering them dead would present four controls that cannot do anything.
    await waitFor(() => {
      expect(screen.queryByText('Notify me about')).not.toBeInTheDocument()
    })
  })
})
