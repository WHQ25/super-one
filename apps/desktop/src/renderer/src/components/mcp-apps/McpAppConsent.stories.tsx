import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import type { McpAppApprovalPrompt } from '@superone/shared/mcp-apps'
import { mcpAppMessagePreview } from '@superone/shared/mcp-apps-content'
import { Button } from '@superone/ui/components/ui/button'
import { richMcpAppMessage } from '../../../../test/fixtures/mcp-apps/rich-message'
import { requestMcpAppConsent, useMcpAppConsents } from './consent-store'
import { McpAppConsentComposer } from './McpAppConsent'

const SESSION = 'story-session'
const server = 'Bits & Bolts'
const rich: McpAppApprovalPrompt = { kind: 'sendMessage', server, ...mcpAppMessagePreview(richMcpAppMessage, server) }
const prompts = {
  rich,
  newConversation: { kind: 'sendMessage', server, ...mcpAppMessagePreview({ ...richMcpAppMessage, _meta: { 'openai/message': { target: 'new' } } }, server) },
  plain: { kind: 'sendMessage', server, text: 'Order 4× M3 hex bolts and add them to the build sheet.', nonTextBlocks: 0 },
  long: { kind: 'sendMessage', server, text: Array.from({ length: 40 }, (_, i) => `Line ${i + 1}: a long, page-authored message the App wants to send on the user's behalf.`).join('\n'), nonTextBlocks: 2 },
} satisfies Record<string, McpAppApprovalPrompt>

/** Queues real requests in the store, so Allow / Deny / Escape dequeue exactly as in the app. */
function Scenario({ queue, framed = true, width = 720 }: { queue: Array<keyof typeof prompts>; framed?: boolean; width?: number }) {
  const [log, setLog] = useState<string[]>([])
  const [round, setRound] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    useMcpAppConsents.setState({ pending: [] })
    for (const key of queue) void requestMcpAppConsent(SESSION, prompts[key], controller.signal).then(value => setLog(entries => [...entries, `${key}: ${value ? 'allowed' : 'denied'}`]))
    return () => controller.abort()
  }, [queue, round])
  return <div className="flex min-h-screen flex-col justify-end gap-3 p-6">
    <div className="space-y-1 text-xs text-muted-foreground">
      {log.map((entry, index) => <p key={index}>{entry}</p>)}
      <Button size="sm" variant="outline" onClick={() => { setLog([]); setRound(value => value + 1) }}>Reset</Button>
    </div>
    <div className={framed ? '@container w-full' : '@container overflow-hidden rounded-2xl border border-border shadow-2xl'} style={{ maxWidth: width }}>
      <McpAppConsentComposer sessionId={SESSION} framed={framed} />
    </div>
  </div>
}

const meta: Meta<typeof Scenario> = { title: 'Chat/MCP Apps/Message Consent', component: Scenario, parameters: { layout: 'fullscreen' }, args: { queue: ['rich'] } }
export default meta
type Story = StoryObj<typeof Scenario>

export const RichMessage: Story = {}
export const NewConversation: Story = { args: { queue: ['newConversation'] } }
/** Approvals queue per session; answering one reveals the next. */
export const Queued: Story = { args: { queue: ['plain', 'rich', 'newConversation'] } }
export const LongContent: Story = { args: { queue: ['long'] } }
/** The collapsed floating chat opens its bubble into this composer; the panel draws the frame. */
export const CollapsedChatBubble: Story = { args: { framed: false, width: 360 } }
export const ChineseNarrow: Story = { args: { width: 360 }, globals: { locale: 'zh' } }
export const Dark: Story = { globals: { theme: 'dark' } }
