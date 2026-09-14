import { useState } from 'react'
import { Pressable, View } from 'react-native'
import type { SessionListItem } from '../session-list-state'
import { useMobileTheme } from '../theme/context'
import { SessionRowContent } from '../ui/session-row-content'
import { Text } from '../ui/text'

/** Real sidebar rows; the local toggle stands in for a host schedule change. */
export function SessionScheduledSendGallery({ width = 280 }: { width?: number }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const [armed, setArmed] = useState(true)
  const [collapsed, setCollapsed] = useState(true)
  const [sendAt] = useState(() => new Date(2026, 8, 15, 18, 30).getTime())
  const item = (title: string, status = 'idle'): SessionListItem => ({
    session: { sessionId: title, title, provider: 'codex', status, scheduledSendAt: armed ? sendAt : null },
    child: false, hasChildren: false, collapsed: false,
  })
  return <View style={{ width, maxWidth: '100%', gap: 8 }}>
    <Text accessibilityRole="header" style={{ color: colors.foreground }}>Scheduled sends</Text>
    <SessionRowContent item={item('Review changes at 18:30')} />
    <SessionRowContent branded subtitle="super-one" item={item('Pinned scheduled session')} />
    <SessionRowContent selected item={item('定时发送 · 很长的会话标题也应保留右侧时钟图标')} />
    <SessionRowContent item={item('Running with a scheduled follow-up', 'running')} />
    <SessionRowContent item={{ ...item('Collaboration parent'), hasChildren: true, collapsed }} onToggleChildren={() => setCollapsed(value => !value)} />
    {!collapsed ? <SessionRowContent item={{ ...item('Scheduled child session'), child: true }} /> : null}
    <SessionRowContent revealed item={item('Swipe actions revealed')} />
    <SessionRowContent item={{ ...item('No scheduled send'), session: { sessionId: 'none', title: 'No scheduled send', scheduledSendAt: null } }} />
    <Pressable accessibilityRole="button" accessibilityLabel="Toggle scheduled sends"
      onPress={() => setArmed(value => !value)} style={{ padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
      <Text style={{ color: colors.foreground }}>{armed ? 'Cancel scheduled sends' : 'Arm scheduled sends'}</Text>
    </Pressable>
  </View>
}
