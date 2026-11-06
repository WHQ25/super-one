import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@superone/ui/components/ui/button'
import { StopButton } from './StopButton'

const meta = {
  title: 'Chat/StopButton',
  component: StopButton,
  parameters: { layout: 'centered' },
  args: { onInterrupt: () => {} },
} satisfies Meta<typeof StopButton>
export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {}
export const Stopping: Story = { args: { stopping: true } }

function RemoteStopDemo() {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('Generating…')
  const [finish, setFinish] = useState<((error?: Error) => void) | null>(null)
  const interrupt = () => {
    setPending(true)
    setMessage('Waiting for the node to stop. New sends are paused.')
    return new Promise<void>((resolve, reject) => {
      setFinish(() => (error?: Error) => {
        setPending(false)
        setFinish(null)
        setMessage(error ? 'Stop was not confirmed. The stop button is available to retry.' : 'Node confirmed the stop. Ready for the next message.')
        if (error) reject(error)
        else resolve()
      })
    })
  }
  return (
    <div className="w-72 space-y-4 rounded-xl border border-border bg-background p-4 text-foreground">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm" role="status">{message}</span>
        <StopButton onInterrupt={interrupt} stopping={pending} />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={!finish} onClick={() => finish?.()}>Confirm Stop</Button>
        <Button variant="outline" size="sm" disabled={!finish} onClick={() => finish?.(new Error('Disconnected'))}>Lose Connection</Button>
      </div>
    </div>
  )
}

/** Click Stop (or hold Escape), then explicitly settle the simulated node. */
export const RemoteAcknowledgement: Story = { render: () => <RemoteStopDemo /> }
