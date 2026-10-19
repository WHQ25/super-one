import type { Meta, StoryObj } from '@storybook/react-vite'
import { RemoteTranscriptChromeView } from './RemoteTranscriptChrome'

const meta = {
  title: 'Chat/RemoteTranscriptChrome',
  component: RemoteTranscriptChromeView,
  parameters: { layout: 'padded' },
  args: {
    edge: 'top',
    summarized: false,
    paging: false,
    resyncing: false,
    hasOlder: true,
    hasNewer: false,
  },
} satisfies Meta<typeof RemoteTranscriptChromeView>

export default meta
type Story = StoryObj<typeof meta>

export const Summarized: Story = {
  args: { summarized: true, hasOlder: true },
}

export const Paging: Story = {
  args: { paging: true, hasOlder: true },
}

export const Resyncing: Story = {
  args: { resyncing: true, hasOlder: false },
}

export const NarrowDarkChinese: Story = {
  args: { summarized: true, paging: true, resyncing: true, hasOlder: true, hasNewer: true },
  globals: { theme: 'dark', locale: 'zh' },
  render: (args) => (
    <div style={{ width: 280 }}>
      <RemoteTranscriptChromeView {...args} edge="top" />
      <RemoteTranscriptChromeView {...args} edge="bottom" />
    </div>
  ),
}
