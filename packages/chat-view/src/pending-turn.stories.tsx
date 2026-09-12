import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage } from '@superone/shared/agent-types'
import { PortableMessage } from './PortableMessage'
import { PendingTurnIndicator } from './presenters/ChatMessageIndicators'

const sent: ChatMessage = {
  id: 'user_first', role: 'user', status: 'complete', providerId: 'local',
  createdAt: new Date().toISOString(),
  content: [{ type: 'text', text: 'Summarize what changed in this branch and draft a PR description.' }],
}

/** The first send on the phone: the bubble is painted before the host has a session for it. */
function PendingTurn({ phase, scheme = 'light', animate = false }: {
  phase: 'creating' | 'sending'; scheme?: 'light' | 'dark'; animate?: boolean
}) {
  const [live, setLive] = useState<'creating' | 'sending' | null>(phase)
  useEffect(() => {
    if (!animate) return
    const timers = [
      setTimeout(() => setLive('sending'), 1500),
      setTimeout(() => setLive(null), 3000),
    ]
    return () => timers.forEach(clearTimeout)
  }, [animate])
  return <div className="mx-auto w-full max-w-[430px] p-4">
    <PortableMessage message={sent} scheme={scheme} pendingPermission={null} />
    {live && <PendingTurnIndicator phase={live} />}
    {animate && !live && <p className="text-xs text-muted-foreground">(assistant row would take over here)</p>}
  </div>
}

const meta = { title: 'Chat/Mobile pending turn', component: PendingTurn,
  render: (args, context) => <PendingTurn {...args} scheme={context.globals.theme ?? 'light'} />,
} satisfies Meta<typeof PendingTurn>
export default meta
type Story = StoryObj<typeof meta>
export const CreatingSession: Story = { args: { phase: 'creating' } }
export const Sending: Story = { args: { phase: 'sending' } }
export const CreatingThenSending: Story = { args: { phase: 'creating', animate: true } }
