import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { RemoteComposerBanner } from './RemoteComposerBanner'

const meta = { title: 'Chat/RemoteComposerBanner', component: RemoteComposerBanner,
  args: { onDisconnect: () => {} }, parameters: { layout: 'padded' } } satisfies Meta<typeof RemoteComposerBanner>
export default meta
type Story = StoryObj<typeof meta>
export const ReadOnly: Story = {}
export const Disconnecting: Story = { args: { busy: true } }
export const Narrow: Story = { decorators: [(Story) => <div style={{ width: 280 }}><Story /></div>] }
export const ReclaimControl: Story = { render: () => {
  const [locked, setLocked] = useState(true)
  return locked ? <RemoteComposerBanner onDisconnect={() => setLocked(false)} />
    : <textarea aria-label="Message" className="w-full rounded-xl border border-border p-4" defaultValue="Continue editing the shared draft" />
} }
