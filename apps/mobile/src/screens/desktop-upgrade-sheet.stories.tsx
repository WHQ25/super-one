import type { ComponentProps } from 'react'
import { MobileThemeProvider } from '../theme/context'
import { DesktopUpgradeSheet } from './desktop-upgrade-sheet'
import { SafeAreaProvider } from 'react-native-safe-area-context'

type Props = ComponentProps<typeof DesktopUpgradeSheet>
const base: Props = {
  problem: { deviceName: 'Studio MacBook Pro', pairingId: 'desk', currentVersion: '0.72.2', minimumVersion: '0.73.0-alpha.1' },
  onReconnect: () => {}, onDismiss: () => {},
}
const Frame = ({ children }: { children: React.ReactNode }) => <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 44, bottom: 34, left: 0, right: 0 } }}>{children}</SafeAreaProvider>
const Preview = (props: Props) => <Frame><MobileThemeProvider colorScheme="dark" locale="en"><DesktopUpgradeSheet {...props} /></MobileThemeProvider></Frame>
export default { title: 'Mobile/DesktopUpgradeSheet', component: DesktopUpgradeSheet, render: Preview, args: base }
export const UpgradeRequired = {}
export const Light = { render: (props: Props) => <Frame><MobileThemeProvider colorScheme="light" locale="en"><DesktopUpgradeSheet {...props} /></MobileThemeProvider></Frame> }
export const Chinese = { render: (props: Props) => <Frame><MobileThemeProvider colorScheme="dark" locale="zh"><DesktopUpgradeSheet {...props} /></MobileThemeProvider></Frame> }
export const Reconnecting = { args: { busy: true } }
export const RetryFailed = { args: { error: 'Desktop is unavailable. Choose another device.' } }
export const UnknownVersion = { args: { problem: { ...base.problem, currentVersion: undefined } } }
export const LongDeviceName = { args: { problem: { ...base.problem, deviceName: 'My desktop computer in the remote production workspace with a long name' } } }
export const Narrow = { parameters: { viewport: { defaultViewport: 'mobile1' } } }
