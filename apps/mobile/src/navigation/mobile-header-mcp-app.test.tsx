import { expect, jest, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { MobileHeader, type McpAppHeaderProps } from './mobile-header'

const noop = () => {}

function header(mcpApp: Partial<McpAppHeaderProps> = {}) {
  return <MobileHeader
    route="chat"
    title="Plan the weekend"
    subtitle="super-one"
    provider="claude"
    hasSession
    deviceStatus="connectedLan"
    onBack={noop}
    onSwitchSession={noop}
    onOpenTerminal={noop}
    onOpenFiles={noop}
    mcpApp={{ title: 'Maps', composerOpen: false, streaming: false, unread: false, onExit: noop, onToggleComposer: noop, ...mcpApp }}
  />
}

test('a fullscreen View takes over the chat header: its name, a way out, and the composer toggle', async () => {
  const onExit = jest.fn()
  const onToggleComposer = jest.fn()
  await renderWithTheme(header({ onExit, onToggleComposer }))

  expect(screen.getByText('Maps')).toBeTruthy()
  expect(screen.queryByText('Plan the weekend')).toBeNull()
  expect(screen.queryByLabelText('Session Actions')).toBeNull()
  expect(screen.queryByLabelText('Open Workspace')).toBeNull()
  await fireEvent.press(screen.getByLabelText('Exit Full Screen'))
  expect(onExit).toHaveBeenCalledTimes(1)
  await fireEvent.press(screen.getByLabelText('Show Composer'))
  expect(onToggleComposer).toHaveBeenCalledTimes(1)
})

test('the toggle reads as on while the composer is open', async () => {
  await renderWithTheme(header({ composerOpen: true, streaming: true }))

  expect(screen.getByLabelText('Hide Composer').props.accessibilityState).toMatchObject({ selected: true })
  expect(screen.queryByTestId('mcp-app-header-running')).toBeNull()
})

test('with the transcript out of sight, the toggle carries a running turn and then its reply', async () => {
  const view = await renderWithTheme(header({ streaming: true }))
  expect(screen.getByLabelText('Show Composer, Agent Is Working')).toBeTruthy()
  expect(screen.getByTestId('mcp-app-header-running')).toBeTruthy()

  await view.rerender(header({ unread: true }))
  expect(screen.getByLabelText('Show Composer, New Reply')).toBeTruthy()
  expect(screen.getByTestId('mcp-app-header-unread')).toBeTruthy()
  expect(screen.queryByTestId('mcp-app-header-running')).toBeNull()
})
