import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage as ChatMessageType } from '@superone/shared/agent-types'
import { encodeMcpMentionValue, wrapMcpResourceMention } from '@superone/shared/mcp-app-mentions'
import { wrapPathRefMention } from '@superone/shared/miniapp-prompt-tags'
import { rememberMcpMentionIcons } from '@/components/mcp-apps/mention-icons'
import { ChatMessage } from './ChatMessage'

/** Bits & Bolts' real icon: one hard-coded dark stroke, tinted to the theme. */
const CAD_ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="none" stroke="#27272a" stroke-width="3" stroke-linejoin="round" d="M9.5 4.75h13L29 16l-6.5 11.25h-13L3 16zM13 10.8h6l3 5.2-3 5.2h-6L10 16z"/></svg>')
/** A two-colour logo, shown as the image it is. */
const TRACKER_ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="#2563eb"/><path d="M4 8h8" stroke="#fff" stroke-width="2"/></svg>')
// What a search answer from Bits & Bolts leaves behind; `no-icon-server` has never answered.
rememberMcpMentionIcons([
  { server: 'bits-and-bolts', tool: 'search_mentions', title: 'Bits & Bolts', icon: CAD_ICON, items: [] },
  { server: 'tracker', tool: 'mentions', title: 'tracker', icon: TRACKER_ICON, items: [] },
])

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

const part = (uri: string, title: string, server = 'bits-and-bolts') => wrapMcpResourceMention(encodeMcpMentionValue(server, uri), title)

const meta = {
  title: 'Chat/MentionChip',
  component: Bubble,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Bubble>

export default meta
type Story = StoryObj<typeof meta>

/**
 * MCP server items (`mentions/search`) next to a file mention: each shows its server's icon and the
 * item's title, not its URI. Bits & Bolts' one-colour icon follows the theme; tracker's logo keeps its colours.
 */
export const McpResource: Story = {
  args: { text: `Check ${part('cad://parts/hex-bolt-m8', 'Hex bolt M8 × 40')} against ${wrapPathRefMention('file', 'docs/torque.md', 'torque.md')} and ${part('tracker://issues/412', 'ENG-412', 'tracker')}` },
}

/** A long title wraps between words in a narrow bubble. */
export const McpResourceLongNarrow: Story = {
  args: {
    width: 320,
    text: `Compare ${part('cad://parts/flange', 'Weld-neck flange DN150 PN40 with raised face and extended hub')} and ${part('cad://parts/gasket', 'Spiral wound gasket')}`,
  },
}

/** A server with no icon of its own, and none SuperOne knows, shows the MCP mark. */
export const McpResourceUnknownServerIcon: Story = {
  args: { text: `Open ${part('tracker://issues/412', 'Bolt torque table is out of date', 'no-icon-server')}` },
}
