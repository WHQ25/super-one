import { createRef, type ComponentProps } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { WebView } from 'react-native-webview'
import { MobileThemeProvider } from '../theme/context'
import { TerminalScreen } from './terminal-screen'

const noop = () => {}

const base: ComponentProps<typeof TerminalScreen> = {
  webRef: createRef<WebView>(),
  writable: true,
  onWebMessage: noop,
  onClaim: noop,
  onKey: noop,
}

function Preview(props: ComponentProps<typeof TerminalScreen>) {
  return (
    <MobileThemeProvider>
      <SafeAreaProvider initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}>
        <View style={{ width: 390, height: 480 }}>
          <TerminalScreen {...props} />
        </View>
      </SafeAreaProvider>
    </MobileThemeProvider>
  )
}

export default {
  title: 'Mobile/TerminalScreen',
  component: TerminalScreen,
  render: Preview,
  args: base,
}

export const Writable = {
  name: 'Writable · shortcut keys only',
}

export const ReadOnly = {
  args: { writable: false },
  name: 'Read-only · take control',
}
