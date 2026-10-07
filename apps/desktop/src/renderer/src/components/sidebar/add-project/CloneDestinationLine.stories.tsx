import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { CloneDestinationLine } from './CloneDestinationLine'

const meta = {
  title: 'Sidebar/Add Project/Clone Destination Line',
  component: CloneDestinationLine,
  args: { path: '~/Developer/Projects/next.js', cloning: false, progress: null },
  // Same width and inset as the repository card in the add-project dialog.
  decorators: [
    (Story, { parameters }) => (
      <div className="border px-3 py-2" style={{ width: parameters.cardWidth ?? '32rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CloneDestinationLine>
export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('progressbar')).toBeNull()
  },
}

/** Before git's first progress line, and for every remote-host clone. */
export const Indeterminate: Story = { args: { cloning: true } }

export const Receiving: Story = {
  args: { cloning: true, progress: 42 },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('progressbar')
    await expect(bar).toHaveAttribute('aria-valuenow', '42')
  },
}

export const AlmostDone: Story = { args: { cloning: true, progress: 97 } }

export const LongPathNarrow: Story = {
  args: {
    cloning: true,
    progress: 63,
    path: '/Users/someone/Developer/Organizations/very-long-organization-name/monorepo-with-a-long-name',
  },
  parameters: { cardWidth: '18rem' },
}
