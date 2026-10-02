import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage as ChatMessageType } from '@superone/shared/agent-types'
import { encodeMcpMentionValue, wrapMcpResourceMention } from '@superone/shared/mcp-app-mentions'
import { wrapPathRefMention } from '@superone/shared/miniapp-prompt-tags'
import { ChatMessage } from './ChatMessage'

/** The user bubble as sent: chips come from the structured tags the composer writes. */
function Bubble({ text, width = 560 }: { text: string; width?: number }) {
  const message: ChatMessageType = {
    id: 'user-1', role: 'user', status: 'complete', providerId: 'user',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    content: [{ type: 'text', text }],
  }
  return (
    <div className="@container rounded-xl border border-border/60 bg-background p-3" style={{ width, maxWidth: '100%' }}>
      <ChatMessage message={message} sessionStatus="idle" isLastAssistant={false} />
    </div>
  )
}

const part = (uri: string, title: string) => wrapMcpResourceMention(encodeMcpMentionValue('bits-and-bolts', uri), title)

const meta = {
  title: 'Chat/MentionChip',
  component: Bubble,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Bubble>

export default meta
type Story = StoryObj<typeof meta>

/** An MCP server item (`mentions/search`) next to a file mention: the chip shows the item's title, not its URI. */
export const McpResource: Story = {
  args: { text: `Check ${part('cad://parts/hex-bolt-m8', 'Hex bolt M8 × 40')} against ${wrapPathRefMention('file', 'docs/torque.md', 'torque.md')} please` },
}

/** A long title wraps between words in a narrow bubble. */
export const McpResourceLongNarrow: Story = {
  args: {
    width: 320,
    text: `Compare ${part('cad://parts/flange', 'Weld-neck flange DN150 PN40 with raised face and extended hub')} and ${part('cad://parts/gasket', 'Spiral wound gasket')}`,
  },
}
