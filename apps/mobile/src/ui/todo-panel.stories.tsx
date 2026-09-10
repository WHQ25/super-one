import type { ReactNode } from 'react'
import { View } from 'react-native'
import type { TodoItem } from '@superone/shared/agent-types'
import { MobileThemeProvider } from '../theme/context'
import { Text } from './text'
import { TodoPanel } from './todo-panel'

function map(...items: TodoItem[]): Record<string, TodoItem> {
  return Object.fromEntries(items.map((item) => [item.id, item]))
}

const running = map(
  { id: '1', subject: 'chat-view: drop the duplicated Tasks card', description: '', status: 'completed' },
  {
    id: '2',
    subject: 'Port the Flutter todo strip',
    activeForm: 'Porting the Flutter todo strip',
    description: 'Row chrome, blockers and the 140 pt scroll cap',
    status: 'in_progress',
  },
  { id: '3', subject: 'Give the tablet the desktop card', description: 'Inset, rounded, hairlined', status: 'pending' },
  { id: '4', subject: 'Hand the sub-plan to a worker', description: '', status: 'pending', owner: 'codex-worker', blockedBy: ['2'] },
  { id: '5', subject: 'typecheck + scoped tests', description: '', status: 'pending', blockedBy: ['3', '4'] },
)

const done = map(
  { id: '1', subject: 'Port the Flutter todo strip', description: '', status: 'completed' },
  { id: '2', subject: 'typecheck + scoped tests', description: '', status: 'completed' },
)

const long = map(
  {
    id: '1',
    subject: 'mobile ui/image-preview.tsx fullscreen modal + stories + jest test, wired into mobile-app.tsx and mobile-overlays.tsx',
    activeForm: 'Wiring the fullscreen image preview through mobile-app.tsx and mobile-overlays.tsx',
    description: 'The row wraps instead of clipping; the badge drops to its own line once the sentence fills the width.',
    status: 'in_progress',
    owner: 'a-worker-with-a-very-long-name',
    blockedBy: ['2'],
  },
  { id: '2', subject: 'chat-view: previewImage helper', description: '', status: 'pending' },
)

function Case({ label, children }: { label: string; children: ReactNode }) {
  return <View style={{ gap: 4 }}>
    <Text style={{ fontSize: 12, opacity: 0.6, paddingHorizontal: 12 }}>{label}</Text>
    {children}
  </View>
}

function Phone() {
  return <MobileThemeProvider>
    <View style={{ width: 390, paddingVertical: 12, gap: 20 }}>
      <Case label="Collapsed · the header pulses while a todo runs">
        <TodoPanel todos={running} tablet={false} />
      </Case>
      <Case label="All done">
        <TodoPanel todos={done} tablet={false} />
      </Case>
      <Case label="Long row · owner and blocker wrap rather than clip">
        <TodoPanel todos={long} tablet={false} />
      </Case>
      <Case label="Empty · the strip renders nothing">
        <TodoPanel todos={{}} tablet={false} />
      </Case>
    </View>
  </MobileThemeProvider>
}

function Tablet() {
  return <MobileThemeProvider>
    <View style={{ width: 820, paddingVertical: 12, gap: 20 }}>
      <Case label="Tablet · the desktop's inset card">
        <TodoPanel todos={running} tablet />
      </Case>
      <Case label="Tablet · long row">
        <TodoPanel todos={long} tablet />
      </Case>
    </View>
  </MobileThemeProvider>
}

export default {
  title: 'Mobile/TodoPanel',
  component: TodoPanel,
  render: Phone,
}

/** Tap the header in each to see the scrolling list, chevrons and descriptions. */
export const PhoneStrip = { render: Phone }
export const TabletCard = { render: Tablet }
