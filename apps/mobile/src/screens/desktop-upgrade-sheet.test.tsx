import { expect, it, jest } from '@jest/globals'
import { userEvent } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { DesktopUpgradeSheet } from './desktop-upgrade-sheet'
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))

const problem = { deviceName: 'Office desktop', pairingId: 'desk', currentVersion: '0.72.2', minimumVersion: '0.73.0-alpha.1' }
it('shows the concrete versions and reconnects only after an explicit tap', async () => {
  const onReconnect = jest.fn(), onDismiss = jest.fn()
  const view = await renderWithTheme(<DesktopUpgradeSheet problem={problem} onReconnect={onReconnect} onDismiss={onDismiss} />)
  expect(view.getByText('SuperOne 0.73.0-alpha.1 or later')).toBeTruthy()
  expect(view.getByText('Current Version: 0.72.2')).toBeTruthy()
  expect(onReconnect).not.toHaveBeenCalled()
  await userEvent.setup().press(view.getByRole('button', { name: 'Reconnect' }))
  expect(onReconnect).toHaveBeenCalledTimes(1)
  await userEvent.setup().press(view.getByRole('button', { name: 'My Devices' }))
  expect(onDismiss).toHaveBeenCalledTimes(1)
})
it('disables duplicate reconnects while busy and names the missing desktop in Chinese', async () => {
  const onReconnect = jest.fn()
  const view = await renderWithTheme(<DesktopUpgradeSheet problem={problem} busy error="Desktop is unavailable. Choose another device." onReconnect={onReconnect} onDismiss={() => {}} />, 'light', 'zh')
  const button = view.getByRole('button', { name: '正在连接…' })
  expect(button.props.accessibilityState.disabled).toBe(true)
  await userEvent.setup().press(button)
  expect(onReconnect).not.toHaveBeenCalled()
  expect(view.getByText('桌面端暂时无法连接，请选择其他设备。')).toBeTruthy()
  expect(view.getByText('SuperOne 0.73.0-alpha.1 或更高版本')).toBeTruthy()
})
