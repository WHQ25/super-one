import { useState } from 'react'
import { View } from 'react-native'
import type { ScheduledSend } from '@superone/shared/agent-types'
import { MobileThemeProvider } from '../theme/context'
import type { ScheduledSendControls } from '../navigation/use-scheduled-send'
import { ScheduledSendPanel } from './scheduled-send-panel'
import { ScheduledSendControl } from './scheduled-send-control'

function Preview({ armed = false, busy = false, offline = false, error = '', light = false }: { armed?: boolean; busy?: boolean; offline?: boolean; error?: string; light?: boolean }) {
  const [scheduled, setScheduled] = useState<ScheduledSend | null>(armed ? { sessionId: 's', sendAt: Date.now() + 3600000, armed: true, source: 'manual', message: '检查定时消息的发送时间' } : null)
  const controls: ScheduledSendControls = { scheduled, available: !offline, loading: false, busy, error,
    schedule: async sendAt => setScheduled({ sessionId: 's', sendAt, armed: true, source: 'manual', message: '检查定时消息的发送时间' }),
    cancel: async () => setScheduled(null), dismiss: async () => setScheduled(null), accept: async () => {} }
  return <MobileThemeProvider colorScheme={light ? 'light' : 'dark'} locale="zh"><View style={{ width: 300, gap: 8 }}>
    <ScheduledSendControl controls={controls} tablet={false} empty={false} onSend={() => {}} />
    <ScheduledSendPanel controls={controls} onClose={() => {}} />
  </View></MobileThemeProvider>
}
export default { title: 'Mobile/ScheduledSend', component: ScheduledSendPanel, render: Preview }
export const Manual = {}
export const Armed = { args: { armed: true } }
export const Saving = { args: { armed: true, busy: true } }
export const Offline = { args: { armed: true, offline: true } }
export const Failed = { args: { error: 'The desktop is unavailable. Please try again.' } }
export const Light = { args: { light: true, armed: true } }
