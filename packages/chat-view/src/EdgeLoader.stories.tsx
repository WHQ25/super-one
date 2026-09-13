import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { EdgeLoader } from './EdgeLoader'

const meta = { title: 'Chat/Mobile transcript edge loader', component: EdgeLoader,
  args: { edge: 'top', loading: false, error: false, onLoad: () => {} },
  decorators: [(Story) => <div className="max-w-[390px] bg-background p-4"><Story /></div>],
} satisfies Meta<typeof EdgeLoader>
export default meta
type Story = StoryObj<typeof meta>

export const TopIdle: Story = {}
export const TopLoading: Story = { args: { loading: true } }
export const TopRetry: Story = { args: { error: true } }
export const BottomIdle: Story = { args: { edge: 'bottom' } }
export const BottomLoading: Story = { args: { edge: 'bottom', loading: true } }
export const BottomRetry: Story = { args: { edge: 'bottom', error: true } }
/** Tap loads for 1.5 s, then fails; tap again to succeed. */
export const Interaction: Story = { render: function Interaction(args) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'error'>('idle')
  return <EdgeLoader {...args} loading={phase === 'loading'} error={phase === 'error'} onLoad={() => {
    setPhase('loading')
    setTimeout(() => setPhase((current) => current === 'loading' && phase === 'idle' ? 'error' : 'idle'), 1500)
  }} />
} }
