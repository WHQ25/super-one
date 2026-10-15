import { useState } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Locale } from '@superone/shared/agent-types'
import { MobileThemeProvider } from '../theme/context'
import { Text } from '../ui/text'
import { SessionHandoffComposer } from './SessionHandoffComposer'

function Slot({ width = 390, locale = 'en', light = false }: { width?: number; locale?: Locale; light?: boolean }) {
  const [outcome, setOutcome] = useState<string | null>(null)
  return <MobileThemeProvider colorScheme={light ? 'light' : 'dark'} locale={locale}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } }}>
      <View style={{ width, minHeight: 360, justifyContent: 'flex-end' }}>
        {outcome ? <Text>{outcome}</Text>
          : <SessionHandoffComposer onApprove={() => setOutcome('Opened the new session')} onDismiss={() => setOutcome('Back to the text composer')} />}
      </View>
    </SafeAreaProvider>
  </MobileThemeProvider>
}

export default { title: 'Mobile/SessionHandoffComposer', component: SessionHandoffComposer }
export const Handoff = { render: () => <Slot /> }
export const Light = { render: () => <Slot light /> }
export const NarrowChineseLight = { render: () => <Slot width={320} locale="zh" light /> }
export const Tablet = { render: () => <Slot width={700} /> }
