import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage as ChatMessageType, ImageAttachment } from '@superone/shared/agent-types'
import { userEvent } from 'storybook/test'
import { encodeMcpMentionValue, formatMcpResourceReminder, wrapMcpResourceMention, type McpMentionReadResource } from '@superone/shared/mcp-app-mentions'
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

// A file chip's right-click menu asks which MCP Apps open the file: none here.
const storyWindow = window as unknown as { environment?: Record<string, unknown> }
storyWindow.environment = { ...storyWindow.environment, mcpAppFileHandlers: async () => ({ ok: true, value: { handlers: [] } }) }

/**
 * The user bubble as sent: chips come from the structured tags the composer writes;
 * `sent` is what the host read for mentioned MCP resources, stored as its own block.
 */
function Bubble({ text, sent = [], width = 560, attachment, paste }: { text: string; sent?: McpMentionReadResource[]; width?: number; attachment?: ImageAttachment; paste?: string }) {
  const block = formatMcpResourceReminder(sent).trim()
  const message: ChatMessageType = {
    id: 'user-1', role: 'user', status: 'complete', providerId: 'user',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    content: [
      { type: 'text', text },
      ...(attachment ? [{ type: 'image' as const, name: attachment.name, id: attachment.id }] : []),
      ...(paste ? [{ type: 'text' as const, text: paste, isPaste: true }] : []),
      ...(block ? [{ type: 'text' as const, text: block }] : []),
    ],
    attachments: attachment ? [attachment] : undefined,
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

const firstMcpChip = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-mention-kind="mcp-resource"]')!

const HEX_BOLT = `# Hex bolt M8 × 40

ISO 4017 hex head screw, fully threaded. Recreated from the supplier drawing.

| Property | Value |
|---|---|
| Thread | M8 × 1.25 |
| Length | 40 mm |
| Head | 13 mm across flats |

Tags: fastener, metric, iso-4017`

/** Hovering a sent chip shows exactly what went to the agent with the message. */
export const McpResourceSentContent: Story = {
  args: {
    text: `Check ${part('cad://parts/hex-bolt-m8', 'Hex bolt M8 × 40')} against the torque table`,
    sent: [{ server: 'bits-and-bolts', uri: 'cad://parts/hex-bolt-m8', mimeType: 'text/markdown', text: HEX_BOLT }],
  },
  play: async ({ canvasElement }) => {
    await userEvent.hover(firstMcpChip(canvasElement))
  },
}

/** A resource cut at the per-resource cap says so; the agent can still read the rest. */
export const McpResourceSentTruncated: Story = {
  args: {
    text: `Summarize ${part('cad://parts/catalogue', 'Full fastener catalogue')}`,
    sent: [{ server: 'bits-and-bolts', uri: 'cad://parts/catalogue', text: Array.from({ length: 80 }, (_, i) => `Row ${i + 1}: M${4 + (i % 12)} bolt, ${10 + i} mm`).join('\n'), truncated: true }],
  },
  play: async ({ canvasElement }) => {
    await userEvent.hover(firstMcpChip(canvasElement))
  },
}

/** Binary or unreadable resources were not inlined: the hover says the agent only got the link. */
export const McpResourceLinkOnly: Story = {
  args: { text: `Open ${part('cad://parts/bracket.step', 'Bracket assembly')}` },
  play: async ({ canvasElement }) => {
    await userEvent.hover(firstMcpChip(canvasElement))
  },
}

/** A sent file mention behaves like a file chip: click opens the file, the icon drags it out, the name selects as text, right-click shows the file menu. */
export const FileMentionContextMenu: Story = {
  args: { text: `Review ${wrapPathRefMention('file', 'docs/torque.md', 'torque.md')} before the next build` },
  play: async ({ canvasElement }) => {
    await userEvent.pointer({ keys: '[MouseRight]', target: canvasElement.querySelector<HTMLElement>('[data-mention-kind="file"]')! })
  },
}

const SCREENSHOT: ImageAttachment = { id: 'shot', name: 'Screenshot 2026-10-05.png', mimeType: 'image/svg+xml', base64: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNjAgMTAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgyPSIxIiB5Mj0iMSI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjNjBhNWZhIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjYTc4YmZhIi8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9IjE2MCIgaGVpZ2h0PSIxMDAiIGZpbGw9InVybCgjZykiLz48cmVjdCB4PSIxNiIgeT0iMTgiIHdpZHRoPSI5MCIgaGVpZ2h0PSIxMCIgcng9IjMiIGZpbGw9IiNmZmYiIG9wYWNpdHk9Ii44NSIvPjxyZWN0IHg9IjE2IiB5PSIzOCIgd2lkdGg9IjEyOCIgaGVpZ2h0PSI4IiByeD0iMyIgZmlsbD0iI2ZmZiIgb3BhY2l0eT0iLjYiLz48L3N2Zz4=' }

/**
 * Every chip kind reads `[icon] [title]` with no fill, as in the composer: file,
 * folder, collaborator, an image attachment, then pasted text. Hover the image or
 * the pasted text for a fuller preview and actions.
 */
export const AllChipKinds: Story = {
  args: {
    text: `See ${wrapPathRefMention('file', 'docs/plans/input-surfaces.md', 'input-surfaces.md')} in ${wrapPathRefMention('directory', 'docs/plans/', 'plans')} and ask ${wrapPathRefMention('agent', 'reviewer', 'reviewer')}`,
    attachment: SCREENSHOT,
    paste: Array.from({ length: 14 }, (_, i) => `line ${i + 1} of the pasted log`).join('\n'),
  },
}

export const AllChipKindsNarrow: Story = {
  args: { ...AllChipKinds.args, width: 300 },
}
