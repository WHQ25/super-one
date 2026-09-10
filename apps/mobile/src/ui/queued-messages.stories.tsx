import type { ChatMessage } from '@superone/shared/agent-types'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { MobileThemeProvider } from '../theme/context'
import { QueuedMessages } from './queued-messages'

const queued: ChatMessage[] = [
  {
    id: 'q1', role: 'user', status: 'complete',
    content: [{ type: 'text', text: '先暂停重构，直接修 queued message 的交互。' }],
    createdAt: '', providerId: 'local',
  },
  {
    id: 'q2', role: 'user', status: 'complete',
    content: [{ type: 'text', text: '修完后补一个 Storybook story。' }],
    createdAt: '', providerId: 'local',
  },
]

const noop = () => {}

function Preview(props: { canSteerSoon?: boolean }) {
  return <MobileThemeProvider>
    <SafeAreaProvider initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, left: 0, right: 0, bottom: 34 },
    }}>
      <View style={{ width: 390, paddingVertical: 16 }}>
        <QueuedMessages messages={queued} canSteer canSteerSoon={props.canSteerSoon ?? true}
          onEdit={noop} onSteer={noop} onSteerSoon={noop} />
      </View>
    </SafeAreaProvider>
  </MobileThemeProvider>
}

export default {
  title: 'Mobile/QueuedMessages',
  component: QueuedMessages,
}

export const Claude = { render: () => <Preview />, name: 'Claude · steer and steer soon' }
export const Codex = { render: () => <Preview canSteerSoon={false} />, name: 'Codex · steer only' }
export const Grok = { render: () => <Preview canSteerSoon={false} />, name: 'Grok · steer only' }
