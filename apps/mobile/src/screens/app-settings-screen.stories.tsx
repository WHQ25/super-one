import { useState } from 'react'
import { View } from 'react-native'
import type { Locale } from '@superone/shared/agent-types'
import { DEFAULT_SESSION_CONTINUATION_HINT } from '@superone/shared/session-continuation'
import type { DeviceStatus } from '../device-status'
import { useMobileLocale } from '../i18n/context'
import { MobileHeader } from '../navigation/mobile-header'
import { MobileThemeProvider, useMobileTheme } from '../theme/context'
import type { MobileColorScheme } from '../theme/tokens'
import { AppSettingsScreen } from './app-settings-screen'

const noop = () => {}

type Props = {
  width: number
  colorScheme: MobileColorScheme
  locale: Locale
  deviceStatus: DeviceStatus
  checking: boolean
}

function Surface({ width, deviceStatus, checking: initialChecking }: Props) {
  const { tokens } = useMobileTheme()
  const { t } = useMobileLocale()
  const [checking, setChecking] = useState(initialChecking)
  const [continuation, setContinuation] = useState(DEFAULT_SESSION_CONTINUATION_HINT)
  return (
    <View style={{ width, height: 640, backgroundColor: tokens.colors.background }}>
      <MobileHeader route="settings" title={t('Settings')} subtitle="Studio MacBook Pro" provider="codex"
        deviceStatus={deviceStatus} onBack={noop} onSwitchSession={noop} onOpenTerminal={noop} onOpenFiles={noop} />
      <AppSettingsScreen update={{ version: '1.0.0', buildCode: 37, checking, onCheckForUpdates: () => setChecking(true) }}
        continuation={{ value: continuation, onChange: (patch) => setContinuation((value) => ({ ...value, ...patch })) }} />
    </View>
  )
}

function Preview(props: Props) {
  return <MobileThemeProvider colorScheme={props.colorScheme} locale={props.locale}><Surface {...props} /></MobileThemeProvider>
}

export default {
  title: 'Mobile/AppSettingsScreen',
  component: AppSettingsScreen,
  render: Preview,
  args: { width: 390, colorScheme: 'dark', locale: 'en', deviceStatus: 'offline', checking: false },
}

export const Offline = {}
export const Reconnecting = { args: { deviceStatus: 'connecting' } }
export const LightMode = { args: { colorScheme: 'light' } }
export const Narrow = { args: { width: 320 } }
export const Chinese = { args: { width: 320, locale: 'zh' } }
export const CheckingForUpdates = { args: { checking: true } }
