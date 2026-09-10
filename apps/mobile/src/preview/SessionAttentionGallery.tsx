import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { SessionActivityContext } from '../navigation/use-session-activity'
import { SessionRowContent } from '../ui/session-row-content'
import { WorkspaceButton } from '../ui/workspace-button'
import { Text } from '../ui/text'
import { countAttentionSessions, type MobileSessionActivity } from '../session-activity-state'

export function SessionAttentionGallery() {
  const [resolved, setResolved] = useState(false)
  const rows = ['Allow Bash?', 'Which implementation should we use for this very long project name?', 'Review plan', null]
  const sessions = Object.fromEntries(rows.map((reason, index): [string, MobileSessionActivity] => [String(index), {
    sessionId: String(index), projectPath: '/project', status: 'idle', provider: index === 1 ? 'codex' : 'claude',
    pendingCount: resolved || !reason ? 0 : index === 0 ? 2 : 1,
    isUnseen: !resolved && index === 3,
    pendingReason: { en: resolved ? null : reason, zh: resolved ? null : ['允许 Bash？', '这个项目应该使用哪一种实现方式？', '审查计划', null][index] },
  }]))
  return <SessionActivityContext.Provider value={sessions}>
    <View style={{ width: 280, gap: 8, padding: 8 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {[0, countAttentionSessions(sessions)].map((count, index) => <WorkspaceButton key={index} pendingCount={count} onPress={() => setResolved(value => !value)} />)}
      </View>
      {rows.map((_, index) => <Pressable key={index} onPress={() => setResolved(value => !value)}>
        <SessionRowContent branded item={{ session: { sessionId: String(index), title: ['Two pending permissions', 'Pinned Codex with a long title', 'Plan review', 'Unread completion'][index], isPinned: true }, child: false, hasChildren: false, collapsed: false }} selected={index === 1} />
      </Pressable>)}
      <Text>{resolved ? 'All sessions cleared. Tap a row to restore.' : '4 sessions need attention: 4 requests and 1 unread completion. Tap a row to clear.'}</Text>
    </View>
  </SessionActivityContext.Provider>
}
