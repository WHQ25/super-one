import type { ComponentProps, ReactNode } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { MobileThemeProvider } from '../theme/context'
import type { SessionListRow } from '../session-list-state'
import { SessionSearchView } from './session-search-screen'

const noop = () => {}

const hits: SessionListRow[] = [
  { sessionId: 'one', title: 'Fix the composer loading state', projectName: 'super-one', provider: 'codex' },
  { sessionId: 'two', title: 'Session search inset', projectName: 'super-one', provider: 'claude' },
  { sessionId: 'three', title: 'Relay ACK window', projectName: 'relay', provider: 'opencode' },
]

const base: ComponentProps<typeof SessionSearchView> = {
  query: '',
  onQuery: noop,
  busy: false,
  error: '',
  results: [],
  onOpenSession: noop,
  onCancel: noop,
}

function Phone({ children, width = 390 }: { children: ReactNode; width?: number }) {
  return (
    <MobileThemeProvider>
      <SafeAreaProvider initialMetrics={{
        frame: { x: 0, y: 0, width, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}>
        {/* Outer padding is the shell SafeAreaView. The field must sit on it,
            not add a second notch inset of its own. */}
        <View style={{ width, height: 640 }}>
          <SafeAreaView style={{ flex: 1 }}>{children}</SafeAreaView>
        </View>
      </SafeAreaProvider>
    </MobileThemeProvider>
  )
}

function Preview(props: ComponentProps<typeof SessionSearchView>) {
  return <Phone><SessionSearchView {...props} /></Phone>
}

export default {
  title: 'Mobile/SessionSearch',
  component: SessionSearchView,
  render: Preview,
  args: base,
}

export const Empty = {}
export const Searching = {
  args: { query: 'auth', busy: true },
}
export const NoMatches = {
  args: { query: 'xyzzy' },
}
export const Failed = {
  args: { query: 'auth', error: 'Search failed' },
  name: 'Error',
}
export const Results = {
  args: { query: 'session', results: hits },
}
export const LongTitles = {
  args: {
    query: 'long',
    results: [
      {
        sessionId: 'long',
        title: 'Investigate why the session search field sits a full status-bar height below the notch on iPhone',
        projectName: 'super-one-mobile-remote-control',
        provider: 'claude' as const,
      },
      ...hits,
    ],
  },
}
export const Narrow = {
  render: (props: ComponentProps<typeof SessionSearchView>) => (
    <Phone width={320}><SessionSearchView {...props} /></Phone>
  ),
  args: { query: 'session', results: hits },
}
