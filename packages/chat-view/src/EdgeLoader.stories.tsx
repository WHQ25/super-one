import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { EdgeLoader } from './EdgeLoader'

const meta = { title: 'Chat/Mobile transcript edge loader', component: EdgeLoader,
  args: { edge: 'top', loading: false },
  decorators: [(Story) => <div className="max-w-[390px] bg-background p-4"><Story /></div>],
} satisfies Meta<typeof EdgeLoader>
export default meta
type Story = StoryObj<typeof meta>

export const TopIdle: Story = {}
export const TopLoading: Story = { args: { loading: true } }
export const BottomIdle: Story = { args: { edge: 'bottom' } }
export const BottomLoading: Story = { args: { edge: 'bottom', loading: true } }
export const NarrowLoading: Story = { args: { loading: true },
  decorators: [(Story) => <div style={{ width: 280 }}><Story /></div>],
}
/** Toggle progress to verify the indicator disappears when loading settles. */
export const Interaction: Story = { render: function Interaction(args) {
  const [loading, setLoading] = useState(false)
  return <><button type="button" onClick={() => setLoading(value => !value)}>Toggle loading</button>
    <EdgeLoader {...args} loading={loading} /></>
} }
