import { useState } from 'react'
import { View } from 'react-native'
import type { ScheduledSend } from '@superone/shared/agent-types'
import { MobileThemeProvider } from '../theme/context'
import type { ScheduledSendControls } from '../navigation/use-scheduled-send'
import { ScheduledSendPanel } from './scheduled-send-panel'
import { ScheduledSendControl } from './scheduled-send-control'

type PreviewProps = { armed?: boolean; busy?: boolean; offline?: boolean; error?: string; light?: boolean; tablet?: boolean; width?: number; source?: ScheduledSend['source']; longMessage?: boolean; defaultMessage?: boolean }

export function ScheduledSendPreview({ armed = false, busy = false, offline = false, error = '', tablet = false, width = 300, source = 'manual', longMessage = false, defaultMessage = false }: PreviewProps) {
  const message = defaultMessage ? null : longMessage ? '检查定时消息的发送时间。'.repeat(20) : '检查定时消息的发送时间'
  const [failure, setFailure] = useState(error)
  const [scheduled, setScheduled] = useState<ScheduledSend | null>(armed ? { sessionId: 's', sendAt: Date.now() + 3600000, armed: true, source, message } : null)
  const controls: ScheduledSendControls = { scheduled, available: !offline, loading: false, busy, error: failure,
    schedule: async sendAt => setScheduled(row => row?.armed ? { ...row, sendAt } : { sessionId: 's', sendAt, armed: true, source: 'manual', message }),
    cancel: async () => setScheduled(row => row?.source === 'rate_limit' ? { ...row, armed: false } : null),
    dismiss: async () => setScheduled(null), accept: async () => {}, retry: async () => setFailure('') }
  return <View style={{ width, maxWidth: '100%', gap: 8 }}>
    <ScheduledSendControl controls={controls} tablet={tablet} empty={false} onSend={() => {}} />
    <ScheduledSendPanel controls={controls} onClose={() => {}} />
  </View>
}
function Preview(props: PreviewProps) {
  return <MobileThemeProvider colorScheme={props.light ? 'light' : 'dark'} locale={props.light ? 'en' : 'zh'}><ScheduledSendPreview {...props} /></MobileThemeProvider>
}
export default { title: 'Mobile/ScheduledSend', component: ScheduledSendPanel, render: Preview, excludeStories: ['ScheduledSendPreview'] }
export const Manual = {}
export const Armed = { args: { armed: true } }
export const Saving = { args: { armed: true, busy: true } }
export const Offline = { args: { armed: true, offline: true } }
export const Failed = { args: { error: 'The desktop is unavailable. Please try again.' } }
export const Light = { args: { light: true, armed: true } }
export const QuotaRecovery = { args: { armed: true, source: 'rate_limit' } }
export const DefaultContinuation = { args: { armed: true, source: 'rate_limit', defaultMessage: true } }
export const CancelFailed = { args: { armed: true, error: 'Control was lost. Retry to reconnect.' } }
export const NarrowLongMessage = { args: { armed: true, width: 240, longMessage: true } }
export const Tablet = { args: { armed: true, tablet: true } }
