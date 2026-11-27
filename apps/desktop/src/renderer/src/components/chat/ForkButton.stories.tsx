import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import type { ChatMessage } from '@superone/shared/agent-types'
import { ForkButton } from './ForkButton'

const sampleMessage: ChatMessage = {
  id: 'a1',
  role: 'assistant',
  content: [{ type: 'text', text: 'Sample assistant response' }],
  status: 'complete',
  createdAt: '2026-01-01T00:00:00.000Z',
  providerId: 'claude',
}

const meta: Meta<typeof ForkButton> = {
  title: 'Chat/ForkButton',
  component: ForkButton,
  args: {
    message: sampleMessage,
  },
}

export default meta
type Story = StoryObj<typeof ForkButton>

export const Default: Story = {}

export const ExpandedMenu: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button'))
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByText('Hand Off to New Session')).toBeInTheDocument()
  },
}
