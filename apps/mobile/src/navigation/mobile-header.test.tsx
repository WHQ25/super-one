import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { MobileHeader } from './mobile-header'

const noop = () => {}

function header(overrides: Partial<Parameters<typeof MobileHeader>[0]> = {}) {
  return <MobileHeader
    route="files"
    title="Files"
    subtitle="super-one"
    provider="claude"
    deviceStatus="connectedLan"
    onBack={noop}
    onSwitchSession={noop}
    onOpenTerminal={noop}
    onOpenFiles={noop}
    {...overrides}
  />
}

test('shows an offline connection on the second line of every native header', async () => {
  await renderWithTheme(header({ deviceStatus: 'offline' }))

  expect(screen.getByText('Files')).toBeTruthy()
  expect(screen.getByText('Offline')).toBeTruthy()
})

test('leaves connection feedback to the persistent sidebar on tablet', async () => {
  await renderWithTheme(header({
    route: 'chat',
    title: 'Session',
    hasSession: true,
    deviceStatus: 'offline',
    connectionInSidebar: true,
  }))

  expect(screen.getByText('super-one')).toBeTruthy()
  expect(screen.queryByText('Offline')).toBeNull()
})
