import { beforeAll, expect, jest, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { SessionAgentLaunchProposal } from '@superone/shared/agent-types'
import { MobileThemeProvider } from '../theme/context'
import { GENERATED_DARK_COLORS } from '../theme/tokens.generated'
import { permissionExamples } from '../preview/permissions'
import { CollabRequestScreen } from './collab-request-screen'

const payload = permissionExamples.session_agents_confirm.sessionAgentsConfirm

/**
 * The chip menus portal into the theme provider's `MenuHost` and size
 * themselves against the safe area, so the insets have to sit *above* the
 * theme provider — `renderWithTheme` would put them below the portal.
 */
function renderScreen(ui: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
    <MobileThemeProvider colorScheme="dark" locale="en">{ui}</MobileThemeProvider>
  </SafeAreaProvider>)
}

// The chips' menus anchor on the trigger's measured frame; the host-component
// mock measures nothing, so a menu would never open without a size to report.
beforeAll(() => {
  const proto = View.prototype as unknown as { measureInWindow: jest.Mock<(cb: (x: number, y: number, w: number, h: number) => void) => void> }
  proto.measureInWindow.mockImplementation((callback) => callback(20, 300, 80, 32))
})

function mount(overrides: Partial<Parameters<typeof CollabRequestScreen>[0]> = {}) {
  const onApprove = jest.fn<(launches: SessionAgentLaunchProposal[]) => void>()
  const onReject = jest.fn<(feedback?: string) => void>()
  return {
    onApprove,
    onReject,
    ui: <CollabRequestScreen payload={payload} onApprove={onApprove} onReject={onReject} {...overrides} />,
  }
}

test('lists every launch under the desktop tab label, with the first one open', async () => {
  const { ui } = mount()
  await renderScreen(ui)
  // Harness names, as the desktop tab strip shows them; the link launch names its peer harness.
  expect(screen.getByLabelText('codex')).toBeTruthy()
  expect(screen.getByLabelText('claude')).toBeTruthy()
  expect(screen.getByLabelText('Agent')).toBeTruthy()
  expect(screen.getByText('Reviewer - Code review')).toBeTruthy()
  expect(screen.getByText('Hand Off To: Designer - Visual review')).toBeTruthy()
  expect(screen.getByText('Work With: Existing review session')).toBeTruthy()
  // Only the first card is expanded: its summary is visible, the others' are not.
  expect(screen.getByText('Review the mobile permission flow.')).toBeTruthy()
  expect(screen.queryByText('Check layout and typography.')).toBeNull()
  // The spawn's tuning is the composer's own chips: the model chip shows the proposal.
  expect(screen.getByText('Preview model')).toBeTruthy()
  expect(screen.getByLabelText('Permission Mode: Default')).toBeTruthy()
})

test('expanding a handoff shows its one-way hint and the same chips', async () => {
  const { ui } = mount()
  await renderScreen(ui)
  await act(async () => { fireEvent.press(screen.getByTestId('collab-launch-preview-handoff')) })
  expect(screen.getByText('Check layout and typography.')).toBeTruthy()
  expect(screen.getByText('Takes the task over in its own top-level session — no replies back to this one.')).toBeTruthy()
  expect(screen.getAllByLabelText(/^Permission Mode:/)).toHaveLength(2)
})

test('a link launch has peer metadata instead of chips', async () => {
  const { ui } = mount()
  await renderScreen(ui)
  await act(async () => { fireEvent.press(screen.getByTestId('collab-launch-preview-link')) })
  expect(screen.getByLabelText('Peer Session: preview-peer')).toBeTruthy()
  // Still one permission chip — the link card must not grow one.
  expect(screen.getAllByLabelText(/^Permission Mode:/)).toHaveLength(1)
})

test('approve is the success fill and reject the destructive one, like the desktop bar', async () => {
  const { ui } = mount()
  await renderScreen(ui)
  const fill = (id: string) => {
    const style = screen.getByTestId(id).props.style
    const flat = Array.isArray(style) ? Object.assign({}, ...style.flat().filter(Boolean)) : style
    return flat.backgroundColor
  }
  expect(fill('prompt-approve')).toBe(GENERATED_DARK_COLORS.success)
  expect(fill('prompt-reject')).toBe(GENERATED_DARK_COLORS.destructive)
})

test('approving hands back every launch with profile defaults and the user’s edits applied', async () => {
  const { ui, onApprove } = mount({
    payload: {
      ...payload,
      profiles: payload.profiles.map((profile) => ({ ...profile, defaultConfig: { effort: 'medium' } })),
    },
  })
  await renderScreen(ui)
  await act(async () => { fireEvent.press(screen.getByTestId('prompt-approve')) })
  const launches = onApprove.mock.calls[0]![0]
  expect(launches).toHaveLength(3)
  // Desktop precedence: profile default under the agent's proposal.
  expect(launches[0].config).toMatchObject({ effort: 'medium', model: 'Preview model', permissionMode: 'default' })
  expect(launches[0].mode).toBe('spawn')
  expect(launches[1].mode).toBe('handoff')
})

test('editing a launch changes only that launch', async () => {
  const { ui, onApprove } = mount()
  await renderScreen(ui)
  await act(async () => { fireEvent.press(screen.getByLabelText('Permission Mode: Default')) })
  await act(async () => { fireEvent.press(screen.getByText('Approve for Me')) })
  await act(async () => { fireEvent.press(screen.getByTestId('prompt-approve')) })
  const launches = onApprove.mock.calls[0]![0]
  expect(launches[0].config.permissionMode).toBe('auto')
  expect(launches[1].config.permissionMode).toBeUndefined()
})

test('rejecting carries the feedback, and the button says so', async () => {
  const { ui, onReject } = mount()
  await renderScreen(ui)
  await act(async () => { fireEvent.changeText(screen.getByTestId('prompt-feedback'), 'Not now') })
  expect(screen.getByText('Reject with Feedback')).toBeTruthy()
  await act(async () => { fireEvent.press(screen.getByTestId('prompt-reject')) })
  expect(onReject).toHaveBeenCalledWith('Not now')
})
