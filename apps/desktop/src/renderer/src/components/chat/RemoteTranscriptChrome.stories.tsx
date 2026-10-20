import type { Meta, StoryObj } from '@storybook/react-vite'
import { RemoteTranscriptChromeView } from './RemoteTranscriptChrome'

const meta = {
  title: 'Chat/RemoteTranscriptChrome',
  component: RemoteTranscriptChromeView,
  parameters: { layout: 'padded' },
  args: {
    edge: 'top',
    summarized: false,
    loading: false,
    hasMore: true,
  },
} satisfies Meta<typeof RemoteTranscriptChromeView>

export default meta
type Story = StoryObj<typeof meta>

export const IdleEarlier: Story = {}

export const Summarized: Story = {
  args: { summarized: true, hasMore: true },
}

export const Paging: Story = {
  args: { loading: true, hasMore: true },
}

export const Resyncing: Story = {
  args: { loading: true, hasMore: false },
}

export const NarrowDarkChinese: Story = {
  args: { summarized: true, loading: true, hasMore: true },
  globals: { theme: 'dark', locale: 'zh' },
  render: (args) => (
    <div style={{ width: 280 }}>
      <RemoteTranscriptChromeView {...args} edge="top" />
      <RemoteTranscriptChromeView {...args} edge="bottom" summarized={false} />
    </div>
  ),
}
