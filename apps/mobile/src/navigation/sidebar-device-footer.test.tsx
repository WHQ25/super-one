import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { SidebarDeviceFooter } from './sidebar-device-footer'

test('puts the connection status directly below the sidebar device', async () => {
  await renderWithTheme(
    <SidebarDeviceFooter
      deviceName="Office Mac"
      deviceStatus="offline"
      onDisconnect={() => {}}
      onOpenSettings={() => {}}
    />,
  )

  expect(screen.getByText('Office Mac')).toBeTruthy()
  expect(screen.getByText('Offline')).toBeTruthy()
})
