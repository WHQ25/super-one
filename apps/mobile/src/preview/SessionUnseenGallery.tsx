import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { SessionActivityContext } from '../navigation/use-session-activity'
import { mergeSessionActivity, type MobileSessionActivity } from '../session-activity-state'
import { SessionRowContent } from '../ui/session-row-content'
import { Text } from '../ui/text'

const initial: MobileSessionActivity = { sessionId: 'unseen-preview', projectPath: '/project', provider: 'codex', status: 'streaming', pendingCount: 0, pendingReason: { en: null, zh: null } }

export function SessionUnseenGallery() {
  const [activity, setActivity] = useState(initial)
  return <SessionActivityContext.Provider value={{ [initial.sessionId]: activity }}>
    <View style={{ maxWidth: 300, gap: 8, padding: 8 }}>
      <Text>Unseen · running → completed → viewed</Text>
      {[false, true].map(pinned => <Pressable key={String(pinned)} accessibilityRole="button"
        accessibilityLabel={pinned ? 'View pinned completion' : 'View completion'}
        onPress={() => setActivity(current => mergeSessionActivity(current, current, current.sessionId))}>
        <SessionRowContent item={{ session: { sessionId: initial.sessionId, title: pinned ? 'Pinned completed session with a long title' : 'Completed session', isPinned: pinned }, child: false, hasChildren: false, collapsed: false }} />
      </Pressable>)}
      <Pressable accessibilityRole="button" accessibilityLabel="Complete background session" style={{ padding: 8 }}
        onPress={() => setActivity(current => mergeSessionActivity(current, { ...current, status: 'idle', completedMessageId: String(Date.now()) }, null, true))}>
        <Text>Complete background session</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Run session again" style={{ padding: 8 }}
        onPress={() => setActivity(current => ({ ...current, status: 'streaming' }))}>
        <Text>Run session again</Text>
      </Pressable>
    </View>
  </SessionActivityContext.Provider>
}
