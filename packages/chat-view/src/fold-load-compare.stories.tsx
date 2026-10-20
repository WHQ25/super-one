import type { Meta, StoryObj } from '@storybook/react-vite'
import { FoldLoadCompare } from './FoldLoadCompare'

const meta = {
  title: 'Chat/Fold first-screen load',
  component: FoldLoadCompare,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FoldLoadCompare>
export default meta

type Story = StoryObj<typeof meta>

/** Set a downlink and latency, then replay the first phone window with and without folds. */
export const Compare: Story = {}

export const Narrow: Story = {
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
}
