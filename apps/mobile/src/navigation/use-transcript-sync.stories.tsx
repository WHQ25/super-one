import { useEffect, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import type { WebView } from 'react-native-webview'
import type { HostInbound } from '@superone/chat-view'
import { createDefaultChatCoreSession } from '@superone/chat-core'
import type { ChatRuntime } from '../runtime'
import { MobileThemeProvider, useMobileTheme } from '../theme/context'
import { SessionMenuBody } from '../ui/session-menu'
import { Text } from '../ui/text'
import { useTranscriptSync } from './use-transcript-sync'

function Preview({ active = false, working = true, width = 390 }: { active?: boolean; working?: boolean; width?: number }) {
  const { tokens: { colors } } = useMobileTheme()
  const [snapshot, setSnapshot] = useState<HostInbound | null>(null)
  const boundary = useMemo(() => ({ current: { injectJavaScript(script: string) {
    new Function('globalThis', script)({ __applyHost: (message: HostInbound) => setSnapshot(message) })
  } } }) as { current: WebView | null }, [])
  const sync = useTranscriptSync(boundary)
  const runtime = useMemo(() => {
    const session = createDefaultChatCoreSession()
    session.realtimeHasTimeline = true
    session.realtimeSessionId = active ? 'rt' : null
    session.status = working ? 'streaming' : 'idle'
    session.realtimeSegments = [{ id: 'speech', realtimeSessionId: 'rt', role: 'user', text: 'Check the history. 检查历史。', localOrder: 10 }]
    session.realtimeThreadMessages = [{ id: 'work', role: 'assistant', providerId: 'codex',
      status: working ? 'streaming' : 'complete', createdAt: new Date(Date.now() - 12_000).toISOString(), content: [],
      metadata: { codexTimeline: { provenance: 'realtime-delegated', turnId: 'task', localOrder: 20 } } }]
    return { session, sessionId: 'offline-voice', projectPath: '/preview' } as unknown as ChatRuntime
  }, [active, working])
  useEffect(() => { sync.publish(runtime, { sessionStatus: runtime.session.status }, true) }, [runtime])
  useEffect(() => {
    if (snapshot && 'delivery' in snapshot && snapshot.delivery) sync.receive({ type: 'transcriptApplied', ...snapshot.delivery })
  }, [snapshot])
  const controls = [
    ['End voice', () => { runtime.session.realtimeSessionId = null; sync.publish(runtime, {}) }],
    ['Reenter session', () => sync.activate()],
    ['Complete work', () => {
      runtime.session.status = 'idle'
      runtime.session.realtimeThreadMessages = runtime.session.realtimeThreadMessages.map(message => ({ ...message, status: 'complete' }))
      sync.publish(runtime, { sessionStatus: 'idle' })
    }],
  ] as const
  return <View style={{ width, padding: 12, gap: 12, backgroundColor: colors.background }}>
    <Text style={{ color: colors.foreground }}>{sync.view === 'realtime' ? 'Voice conversation' : 'Codex conversation'}</Text>
    {controls.map(([label, onPress]) => <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={{ color: colors.foreground, padding: 8 }}>{label}</Text>
    </Pressable>)}
    <SessionMenuBody onOpenTerminal={() => {}} onOpenFiles={() => {}} conversationView={sync.view}
      onToggleConversationView={() => sync.setView(sync.view === 'realtime' ? 'thread' : 'realtime')} />
  </View>
}
function Frame({ active, working, narrow, light }: { active?: boolean; working?: boolean; narrow?: boolean; light?: boolean }) {
  return <MobileThemeProvider colorScheme={light ? 'light' : 'dark'} locale="zh">
    <Preview active={active} working={working} width={narrow ? 320 : 390} />
  </MobileThemeProvider>
}
export default { title: 'Mobile/Voice Conversation Entry', component: Frame }
export const ActiveVoice = { render: () => <Frame active /> }
export const EndedWhileWorking = { render: () => <Frame /> }
export const EndedCompleted = { render: () => <Frame working={false} /> }
export const NarrowLightChinese = { render: () => <Frame narrow light /> }
