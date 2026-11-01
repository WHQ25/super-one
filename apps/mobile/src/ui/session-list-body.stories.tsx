import type { ReactNode } from 'react'
import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import type { ProjectSessions } from '../navigation/use-project-sessions'
import type { SessionListItem } from '../session-list-state'
import { SessionListBody } from './session-list-body'

const noop = () => {}
const confirmed = () => Promise.resolve(true)

const row = (sessionId: string, title: string, extra: Partial<SessionListItem> = {}): SessionListItem => ({
  session: { sessionId, title },
  child: false,
  hasChildren: false,
  collapsed: false,
  ...extra,
})

const children = Array.from({ length: 8 }, (_, index) => row(`c${index}`, `Child session ${index + 1}`, { child: true }))

function sessions(items: SessionListItem[]): ProjectSessions {
  return {
    items, busy: false, loaded: true, loadingMore: false, error: '', hasMore: false, loadedCount: items.length,
    loadMore: noop, toggleChildren: noop, forget: noop, patch: noop,
  }
}

function Frame({ children: content }: { children: ReactNode }) {
  return (
    <MobileThemeProvider>
      <View style={{ width: 300, paddingVertical: 12, backgroundColor: '#111' }}>{content}</View>
    </MobileThemeProvider>
  )
}

const actions = {
  onOpenSession: noop,
  onPinSession: confirmed,
  onSettleSession: confirmed,
  onDeleteSession: confirmed,
}

export default {
  title: 'Mobile/SessionListBody',
  component: SessionListBody,
}

export const ExpandedChildren = {
  render: () => (
    <Frame>
      <SessionListBody
        {...actions}
        sessions={sessions([
          row('p', 'Collaboration parent', { hasChildren: true }),
          ...children,
          row('q', 'Next parent'),
        ])}
      />
    </Frame>
  ),
  name: 'Expanded parent · child scroll',
}
