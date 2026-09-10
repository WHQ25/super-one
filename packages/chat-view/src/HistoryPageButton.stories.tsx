import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { HistoryPageButton } from './HistoryPageButton'
const meta = { title: 'Chat/Mobile history pagination', component: HistoryPageButton,
  args: { loading: false, error: false, onLoad: () => {} },
  decorators: [(Story) => <div className="max-w-[390px] p-4"><Story /></div>],
} satisfies Meta<typeof HistoryPageButton>
export default meta
type Story = StoryObj<typeof meta>
export const Ready: Story = {}
export const Loading: Story = { args: { loading: true } }
export const Retry: Story = { args: { error: true } }
export const Interaction: Story = { render: function Interaction() {
  const [loading, setLoading] = useState(false)
  return <HistoryPageButton loading={loading} error={false} onLoad={() => setLoading(true)} />
} }
