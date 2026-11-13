import type { Meta, StoryObj } from '@storybook/react-vite'
import { CompactErrorIndicator } from './ChatMessageIndicators'

const longError = "it'll retry on the next turn, or start a new session using /new. request error: error sending request for url (https://api.example.com/v1/responses)"

const meta = {
  title: 'Chat/Compaction failed',
  component: CompactErrorIndicator,
  parameters: { layout: 'padded' },
  args: {
    error: longError,
    onDismiss: () => {},
  },
  decorators: [(Story) => <div className="w-[640px] max-w-full"><Story /></div>],
} satisfies Meta<typeof CompactErrorIndicator>

export default meta
type Story = StoryObj<typeof meta>

/** Wide row: the failure label stays intact and the request error ellipsizes. */
export const LongError: Story = {}

/** Narrow row: the label still does not wrap; only the detail gives up space. */
export const Narrow: Story = {
  decorators: [(Story) => <div className="w-56"><Story /></div>],
}

export const ShortError: Story = {
  args: { error: 'context too small' },
}

export const DarkChinese: Story = {
  globals: { theme: 'dark', locale: 'zh' },
}
