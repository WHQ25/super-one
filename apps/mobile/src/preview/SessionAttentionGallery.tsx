import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { SessionActivityContext } from '../navigation/use-session-activity'
import { SessionRowContent } from '../ui/session-row-content'
import { WorkspaceButton } from '../ui/workspace-button'
import { Text } from '../ui/text'
import type { SessionActivity } from '@superone/shared/session-activity'

export function SessionAttentionGallery() {
  const [resolved, setResolved] = useState(false)
  const rows = ['Allow Bash?', 'Which implementation should we use for this very long project name?', 'Review plan']
  const sessions = Object.fromEntries(rows.map((reason, index): [string, SessionActivity] => [String(index), {
    sessionId: String(index), projectPath: '/project', status: 'idle', provider: index === 1 ? 'codex' : 'claude',
    pendingCount: resolved ? 0 : 1, pendingReason: { en: resolved ? null : reason, zh: resolved ? null : ['允许 Bash？', '这个项目应该使用哪一种实现方式？', '审查计划'][index] },
  }]))
  return <SessionActivityContext.Provider value={sessions}>
    <View style={{ width: 280, gap: 8, padding: 8 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {[0, resolved ? 0 : 3, 120].map((count, index) => <WorkspaceButton key={index} pendingCount={count} onPress={() => setResolved(value => !value)} />)}
      </View>
      {rows.map((_, index) => <Pressable key={index} onPress={() => setResolved(value => !value)}>
        <SessionRowContent item={{ session: { sessionId: String(index), title: ['Pinned Claude', 'Pinned Codex with a long title', 'Plan review'][index], isPinned: true }, child: false, hasChildren: false, collapsed: false }} selected={index === 1} />
      </Pressable>)}
      <Text>Tap a row to resolve / restore requests</Text>
    </View>
  </SessionActivityContext.Provider>
}
