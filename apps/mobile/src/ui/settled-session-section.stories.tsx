import type { ReactNode } from 'react'
import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import { Text } from './text'
import { SettledSessionSection } from './settled-session-section'

const noop = () => {}
const session = { sessionId: 'done', title: 'Ship the sidebar settle group' }
const longSession = {
  sessionId: 'long',
  title: 'A settled session whose title is long enough to ellipsize inside a narrow phone sidebar',
}

function Frame({ children, width = 300 }: { children: ReactNode; width?: number }) {
  return (
    <MobileThemeProvider>
      <View style={{ width, paddingVertical: 12, backgroundColor: '#111' }}>{children}</View>
    </MobileThemeProvider>
  )
}

const base = {
  onToggle: noop,
  onOpenSession: noop,
  onSettleSession: noop,
  onDeleteSession: noop,
}

export default {
  title: 'Mobile/SettledSessionSection',
  component: SettledSessionSection,
}

export const Folded = {
  render: () => <Frame><SettledSessionSection {...base} rows={[session]} total={12} open={false} /></Frame>,
  name: 'Folded · count',
}

export const Open = {
  render: () => <Frame><SettledSessionSection {...base} rows={[session, longSession]} total={2} open /></Frame>,
  name: 'Open',
}

const page = Array.from({ length: 12 }, (_, index) => ({
  sessionId: `done-${index}`,
  title: index === 0 ? session.title : `Settled session ${index + 1}`,
}))

export const Scroll = {
  render: () => <Frame><SettledSessionSection {...base} rows={page} total={40} open hasMore onLoadMore={noop} /></Frame>,
  name: 'Open · scrolls for more',
}

export const LoadingMore = {
  render: () => <Frame><SettledSessionSection {...base} rows={page} total={40} open hasMore loadingMore onLoadMore={noop} /></Frame>,
  name: 'Open · loading more',
}

export const Empty = {
  render: () => <Frame>
    <Text style={{ color: '#888', fontSize: 12, paddingHorizontal: 12 }}>Nothing below this line — an empty project renders no group.</Text>
    <SettledSessionSection {...base} rows={[]} total={0} open={false} />
  </Frame>,
  name: 'Empty',
}

export const Error = {
  render: () => <Frame><SettledSessionSection {...base} rows={[]} total={0} open={false} error="Could not load settled sessions" /></Frame>,
  name: 'Error',
}

export const Narrow = {
  render: () => <Frame width={220}><SettledSessionSection {...base} rows={[longSession]} total={1} open /></Frame>,
  name: 'Narrow',
}
