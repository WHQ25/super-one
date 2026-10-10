import { View } from 'react-native'
import { useState } from 'react'
import { MobileThemeProvider, useMobileTheme } from '../theme/context'
import { Text } from './text'
import { SessionMenuBody } from './session-menu'

function Menu({ forkable, initialView }: { forkable: boolean; initialView?: 'realtime' | 'thread' }) {
  const [view, setView] = useState(initialView)
  const { tokens: { colors } } = useMobileTheme()
  return <View style={{ width: 260, padding: 8, backgroundColor: colors.background, borderRadius: 12 }}>
        {view ? <Text style={{ color: colors.mutedForeground, padding: 8 }}>{view === 'realtime' ? 'Voice conversation' : 'Codex conversation'}</Text> : null}
        <SessionMenuBody
          onOpenTerminal={() => {}}
          onOpenFiles={() => {}}
          onFork={forkable ? () => {} : undefined}
          conversationView={view}
          onToggleConversationView={() => setView(view === 'realtime' ? 'thread' : 'realtime')}
        />
      </View>
}
function Frame({ scheme = 'dark', locale = 'en', ...props }: {
  forkable: boolean; initialView?: 'realtime' | 'thread'; scheme?: 'dark' | 'light'; locale?: 'en' | 'zh'
}) {
  return <MobileThemeProvider colorScheme={scheme} locale={locale}><Menu {...props} /></MobileThemeProvider>
}

export default {
  title: 'Mobile/SessionMenu',
  component: SessionMenuBody,
}

export const Forkable = {
  name: 'Forkable · terminal, files, both fork targets',
  render: () => <Frame forkable />,
}

export const NotForkable = {
  name: 'Not forkable · worktree session or harness without fork',
  render: () => <Frame forkable={false} />,
}

export const VoiceHistory = { name: 'Voice history · switch to backing Codex', render: () => <Frame forkable initialView="realtime" /> }
export const CodexHistory = { name: 'Codex history · switch back to voice', render: () => <Frame forkable initialView="thread" scheme="light" /> }
export const VoiceChinese = { name: 'Voice history · narrow Chinese menu', render: () => <Frame forkable={false} initialView="realtime" locale="zh" /> }
