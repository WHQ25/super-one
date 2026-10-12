/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HarnessId } from '@superone/shared/agent-types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const { HarnessPermissionPopover } = await import('./HarnessPermissionPopover')

describe('HarnessPermissionPopover', () => {
  it.each<[HarnessId, string]>([
    ['claude', 'chat.permissionModes.default.label'],
    ['codex', 'resources.automation.defaultValue'],
    ['acp', 'chat.acpPermissionModes.ask.label'],
    ['cursor', 'chat.cursorPermissionModes.agent.label'],
    // dsh speaks its own presets on launch rows too, not Claude's "Normal".
    ['dsh', 'chat.deepseekPermissionPresets.workspaceWrite.label'],
  ])('shows the default %s starts in when the launch has not chosen', (harnessId, label) => {
    render(<HarnessPermissionPopover harnessId={harnessId} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: label })).toBeTruthy()
  })

  it('renders nothing for a harness without permission modes', () => {
    const { container } = render(<HarnessPermissionPopover harnessId="opencode" onChange={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('offers Codex launch presets as the permission mode a launch config carries', async () => {
    const onChange = vi.fn()
    render(<HarnessPermissionPopover harnessId="codex" value="bypassPermissions" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'resources.automation.fullAccess' }))
    // read-only has no PermissionMode spelling, so a launch cannot offer it.
    expect(screen.queryByText('resources.automation.readOnly')).toBeNull()
    await userEvent.click(screen.getByText('resources.automation.approveForMe'))
    expect(onChange).toHaveBeenCalledWith('auto')
  })
})
