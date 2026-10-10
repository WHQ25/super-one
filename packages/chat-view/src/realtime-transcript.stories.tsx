import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import type { ChatMessage, RealtimeTimelineSegment } from '@superone/shared/agent-types'
import { projectRealtimeTranscript } from '@superone/shared/realtime-transcript-projection'
import { PortableMessage } from './PortableMessage'
import { PortableRealtimeActivity } from './PortableRealtimeActivity'
import { installFakeNativeHost } from './fixtures/native-host'

const speech: RealtimeTimelineSegment[] = [
  { id: 'user', realtimeSessionId: 'rt', role: 'user', text: 'Check the sign-in flow.', localOrder: 1 },
  { id: 'agent', realtimeSessionId: 'rt', role: 'assistant', text: 'I am checking it now.', localOrder: 2 },
  { id: 'followup', realtimeSessionId: 'rt', role: 'user', text: 'How is it going?', localOrder: 10 },
]
function Preview({ status = 'streaming', width = 390, scheme = 'light' }: {
  status?: ChatMessage['status']; width?: number; scheme?: 'light' | 'dark'
}) {
  const [view, setView] = useState<'realtime' | 'thread'>('realtime')
  useEffect(() => installFakeNativeHost((request, reply) => {
    if (request.action === 'openRealtimeThread') { setView('thread'); reply({ result: true }) }
  }), [])
  const messages: ChatMessage[] = [{ id: 'work', role: 'assistant', providerId: 'codex', status,
    content: [{ type: 'text', text: 'The backing Codex task checks the authentication handlers.' }], createdAt: new Date(Date.now() - 12_000).toISOString(),
    metadata: { codexTimeline: { provenance: 'realtime-delegated', localOrder: 3, turnId: 'task' } } }]
  const voice = projectRealtimeTranscript({ messages, segments: speech, liveSegments: [],
    sessionStatus: status === 'streaming' ? 'streaming' : 'idle', needsDecision: false })
  const rows = view === 'realtime' ? voice.messages : messages
  return <div style={{ width }} className="mx-auto p-4">
    <button className="mb-4 text-xs text-muted-foreground" onClick={() => setView(view === 'realtime' ? 'thread' : 'realtime')}>
      {view === 'realtime' ? 'Show Codex conversation' : 'Show voice conversation'}
    </button>
    {rows.map(message => <div key={message.id}>
      <PortableMessage message={message} scheme={scheme} pendingPermission={null} hideCopyActions={view === 'realtime'} />
      {view === 'realtime' && voice.activities.filter(row => row.afterMessageId === message.id)
        .map(row => <PortableRealtimeActivity key={row.turnId} row={row} />)}
    </div>)}
    {view === 'realtime' && voice.activities.filter(row => row.afterMessageId === null)
      .map(row => <PortableRealtimeActivity key={row.turnId} row={row} />)}
  </div>
}
const meta = { title: 'Chat/Mobile voice history', component: Preview,
  render: (args, context) => <Preview {...args} scheme={context.globals.theme ?? 'light'} />,
} satisfies Meta<typeof Preview>
export default meta
type Story = StoryObj<typeof meta>
export const Working: Story = {}
export const Completed: Story = { args: { status: 'complete' } }
export const Failed: Story = { args: { status: 'error' } }
export const Narrow: Story = { args: { width: 320 } }
