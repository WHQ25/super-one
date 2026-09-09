import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { MobileHeader } from '../navigation/mobile-header'
import { SessionRowContent } from '../ui/session-row-content'
import { Text } from '../ui/text'

const noop = () => {}
const titles = ['Rename', 'Review session titles', '调整移动端会话标题与动画', 'A long session title that should truncate gracefully on a narrow phone screen']

export function SessionTitleGallery() {
  const [revision, setRevision] = useState(0)
  const title = titles[revision % titles.length]!
  return <View style={{ gap: 12, width: '100%', maxWidth: 390 }}>
    <MobileHeader route="chat" title="New session" provider="codex" deviceStatus="connectedLan"
      onBack={noop} onSwitchSession={noop} onOpenTerminal={noop} onOpenFiles={noop} />
    <MobileHeader route="chat" title={title} hasSession sessionId="preview-title" provider="codex" deviceStatus="connectedLan"
      onBack={noop} onSwitchSession={noop} onOpenTerminal={noop} onOpenFiles={noop} />
    <Pressable accessibilityRole="button" onPress={() => setRevision(value => value + 1)} style={{ padding: 12 }}>
      <Text>Rename session · short / English / 中文 / long</Text>
    </Pressable>
    {['idle', 'running', 'starting', 'background', 'unseen', 'ended'].map(status => <SessionRowContent key={status}
      selected={status === 'idle'} subtitle={status}
      item={{ session: { sessionId: status, title, provider: 'codex', status }, child: false, hasChildren: false, collapsed: false }} />)}
  </View>
}
