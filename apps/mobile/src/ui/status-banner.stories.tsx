import { useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { MobileThemeProvider } from '../theme/context'
import { Text } from './text'
import { StatusBanner } from './status-banner'

function Frame({ children }: { children: ReactNode }) {
  return <MobileThemeProvider>
    <SafeAreaProvider initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, left: 0, right: 0, bottom: 34 },
    }}>
      <View style={{ width: 390, backgroundColor: '#111', paddingTop: 12 }}>
        <View style={{ borderBottomColor: '#333', borderBottomWidth: 1, paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={{ color: '#eee', fontSize: 17, fontWeight: '500', textAlign: 'center' }}>调小 Expo 图标文字</Text>
        </View>
        {children}
        <View style={{ height: 120, backgroundColor: '#111' }} />
      </View>
    </SafeAreaProvider>
  </MobileThemeProvider>
}

export default {
  title: 'Mobile/StatusBanner',
  component: StatusBanner,
}

export const HostError = {
  render: () => <Frame>
    <StatusBanner
      message="Queued ACP message not found: user_3296d81d-13bd-4a4c-b29d-29f864a6089c"
      onDismiss={() => {}}
    />
  </Frame>,
  name: 'Host error · copy and close',
}

export const ShortNotice = {
  render: () => <Frame>
    <StatusBanner message="The conversation is still loading. Please send again when it is ready." onDismiss={() => {}} />
  </Frame>,
  name: 'Short notice',
}

export const Dismissible = {
  render: function DismissibleStory() {
    const [message, setMessage] = useState('chat renderer failed: content process terminated')
    return <Frame>
      <StatusBanner message={message} onDismiss={() => setMessage('')} />
    </Frame>
  },
  name: 'Dismissible · close clears the strip',
}

export const Chinese = {
  render: () => <MobileThemeProvider locale="zh">
    <SafeAreaProvider initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, left: 0, right: 0, bottom: 34 },
    }}>
      <View style={{ width: 390 }}>
        <StatusBanner
          message="Queued ACP message not found: user_3296d81d-13bd-4a4c-b29d-29f864a6089c"
          onDismiss={() => {}}
        />
      </View>
    </SafeAreaProvider>
  </MobileThemeProvider>,
  name: 'Chinese · copy and close',
}

export const Narrow = {
  render: () => <MobileThemeProvider>
    <SafeAreaProvider initialMetrics={{
      frame: { x: 0, y: 0, width: 320, height: 568 },
      insets: { top: 20, left: 0, right: 0, bottom: 0 },
    }}>
      <View style={{ width: 320 }}>
        <StatusBanner
          message="Queued ACP message not found: user_3296d81d-13bd-4a4c-b29d-29f864a6089c"
          onDismiss={() => {}}
        />
      </View>
    </SafeAreaProvider>
  </MobileThemeProvider>,
  name: 'Narrow layout',
}
