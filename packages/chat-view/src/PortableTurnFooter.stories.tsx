import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage } from '@superone/shared/agent-types'
import { PortableMessage } from './PortableMessage'

function FailedTurn({ provider = 'codex', width = 390, withUsage = true, scheme = 'light' }: {
  provider?: 'codex' | 'claude'
  width?: number
  withUsage?: boolean
  scheme?: 'light' | 'dark'
}) {
  const text = 'I checked the implementation before the request failed.'
  const message: ChatMessage = {
    id: 'failed-turn', role: 'assistant', status: 'error', providerId: provider,
    createdAt: '2026-09-14T00:00:00.000Z',
    content: [{ type: 'text', text }],
    metadata: {
      ...(withUsage ? { durationMs: 45_000, consumedTokens: { input: 18_400, output: 2_600 } } : {}),
      errorInfo: {
        code: provider === 'codex' ? 'cyberPolicy' : 'overloaded',
        requestId: 'request_' + 'a'.repeat(100),
        raw: 'The request failed before the response finished. Please try again.\n'
          + 'Additional diagnostic details from the provider. '.repeat(4),
      },
      ...(provider === 'codex' ? {
        codex: { threadId: 'thread', usage: null, items: [{ id: 'reply', type: 'agent_message', text }] },
      } : {}),
    },
  }
  return (
    <div className="max-w-full p-3" style={{ width }}>
      <PortableMessage message={message} scheme={scheme} pendingPermission={null}
        isLastAssistant sessionStreaming={false} />
    </div>
  )
}

const meta = {
  title: 'Chat/Mobile turn errors',
  component: FailedTurn,
  parameters: { layout: 'padded' },
  render: (args, context) => <FailedTurn {...args} scheme={context.globals.theme ?? 'light'} />,
} satisfies Meta<typeof FailedTurn>
export default meta
type Story = StoryObj<typeof meta>

export const Collapsed: Story = {}

export const CodexExpanded: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { expanded: false }))
  },
}

export const ClaudeExpanded: Story = {
  args: { provider: 'claude' },
  play: CodexExpanded.play,
}

export const Narrow: Story = {
  args: { width: 320 },
  play: CodexExpanded.play,
}

export const WithoutUsage: Story = {
  args: { withUsage: false },
  play: CodexExpanded.play,
}
