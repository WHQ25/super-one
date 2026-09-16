/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HarnessId } from '@superone/shared/agent-types'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'

const getAppSettings = vi.fn()
const saveAppSettings = vi.fn()

vi.mock('@/stores/app', () => ({
  useAppStore: (selector: (s: unknown) => unknown) => selector({
    sandboxCapability: { supportLevel: 'always', defaultMode: 'on' },
    sandboxProbe: null,
    probeSandbox: vi.fn(),
  }),
}))

vi.mock('@/stores/chat', () => ({ invalidateDefaultPermissionModeCache: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const { SessionDefaultsSection } = await import('./SessionDefaultsSection')

function settingsWith(preference: Record<string, unknown>) {
  return {
    agentPreference: {
      claude: { defaultPermissionMode: '', defaultSandboxMode: '' },
      codex: { defaultPermissionPreset: '' },
      acp: { defaultPermissionMode: '' },
      cursor: { defaultPermissionMode: '', defaultSandboxMode: '' },
      dsh: { defaultPermissionMode: '' },
      opencode: { defaultPermissionMode: '' },
      ...preference,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getAppSettings.mockResolvedValue(settingsWith({}))
  saveAppSettings.mockResolvedValue(settingsWith({}))
  Object.defineProperty(window, 'app', {
    configurable: true,
    value: { getAppSettings, saveAppSettings },
  })
})

describe('SessionDefaultsSection', () => {
  /**
   * The row has to say what the session would actually start in. Showing a
   * blank, or Claude's mode, is how the phone and the desktop drifted apart.
   */
  it.each<[HarnessId, string]>([
    ['dsh', 'plan'],
  ])('shows the first mode %s declares when nothing is configured', async (harnessId, mode) => {
    render(<SessionDefaultsSection harnessId={harnessId} />)

    await waitFor(() => {
      expect(screen.getByText(`chat.permissionModes.${mode}.label`)).toBeInTheDocument()
    })
  })

  it('shows Ask for an unconfigured ACP session', async () => {
    render(<SessionDefaultsSection harnessId="acp" />)

    await waitFor(() => {
      expect(screen.getByText('chat.acpPermissionModes.ask.label')).toBeInTheDocument()
    })
  })

  /**
   * Cursor names its ladder in its own i18n namespace — `agent` has no entry in
   * the shared descriptor table, so a row using that table would render some
   * other mode's label entirely.
   */
  it('names the Cursor ladder from the Cursor vocabulary', async () => {
    render(<SessionDefaultsSection harnessId="cursor" />)

    await waitFor(() => {
      expect(screen.getByText('chat.cursorPermissionModes.agent.label')).toBeInTheDocument()
    })
  })

  it('shows the mode configured for that harness', async () => {
    getAppSettings.mockResolvedValue(settingsWith({ acp: { defaultPermissionMode: 'auto' } }))

    render(<SessionDefaultsSection harnessId="acp" />)

    await waitFor(() => {
      expect(screen.getByText('chat.acpPermissionModes.auto.label')).toBeInTheDocument()
    })
  })

  it('opens the ACP list with Ask / Always Approve, not Claude Normal / Bypass', async () => {
    render(<SessionDefaultsSection harnessId="acp" />)
    await waitFor(() => expect(getAppSettings).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /acpPermissionModes/ }))

    expect(await screen.findByText('chat.acpPermissionModes.alwaysApprove.label')).toBeInTheDocument()
    expect(screen.queryByText('chat.permissionModes.default.label')).not.toBeInTheDocument()
    expect(screen.queryByText('chat.permissionModes.bypassPermissions.label')).not.toBeInTheDocument()
  })

  it('keeps Claude on Normal / Bypass', async () => {
    render(<SessionDefaultsSection harnessId="claude" />)
    await waitFor(() => expect(getAppSettings).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /permissionModes/ }))

    expect(await screen.findByText('chat.permissionModes.bypassPermissions.label')).toBeInTheDocument()
    expect(screen.queryByText('chat.acpPermissionModes.alwaysApprove.label')).not.toBeInTheDocument()
  })

  it('writes the pick to that harness alone', async () => {
    render(<SessionDefaultsSection harnessId="dsh" />)
    await waitFor(() => expect(getAppSettings).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /permissionModes/ }))
    await userEvent.click(await screen.findByText('chat.permissionModes.bypassPermissions.label'))

    await waitFor(() => {
      expect(saveAppSettings).toHaveBeenCalledWith({
        agentPreference: { dsh: { defaultPermissionMode: 'bypassPermissions' } },
      })
    })
  })

  /** Offering a mode the harness cannot execute is worse than offering none. */
  it('offers only the modes the harness declares', async () => {
    render(<SessionDefaultsSection harnessId="dsh" />)
    await waitFor(() => expect(getAppSettings).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /permissionModes/ }))

    for (const mode of HARNESS_LAUNCH_OPTIONS.dsh.permissionModes) {
      // The trigger renders the active label too, so `plan` legitimately appears twice.
      expect((await screen.findAllByText(`chat.permissionModes.${mode}.label`)).length).toBeGreaterThan(0)
    }
    expect(screen.queryByText('chat.permissionModes.acceptEdits.label')).not.toBeInTheDocument()
  })

  /**
   * Sandbox is a row only where the harness owns a real toggle. The others
   * derive it from their permission setting and have nothing to configure.
   */
  it('renders a sandbox row only for the harnesses that own one', async () => {
    const { unmount } = render(<SessionDefaultsSection harnessId="claude" />)
    await waitFor(() => {
      expect(screen.getByText('settings.preferences.sandbox.label')).toBeInTheDocument()
    })
    unmount()

    render(<SessionDefaultsSection harnessId="acp" />)
    await waitFor(() => expect(getAppSettings).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('settings.preferences.sandbox.label')).not.toBeInTheDocument()
  })
})
