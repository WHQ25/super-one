import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, type ReactNode } from 'react'
import type { PermissionRequest, WebmcpTrustConfirmPayload, WebmcpTrustToolSummary } from '@superone/shared/agent-types'
import { WebMcpTrustPrompt } from './WebMcpTrustPrompt'

function StoryShell({ children, width = 560 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container space-y-2" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-3 text-xs leading-relaxed text-muted-foreground">{children}</p>
}

function pageTool(
  name: string,
  description: string,
  annotations: WebmcpTrustToolSummary['annotations'] = {},
  changed = false,
): WebmcpTrustToolSummary {
  return { name, description, annotations, ...(changed ? { changed: true } : {}) }
}

const SHOP_TOOLS: WebmcpTrustToolSummary[] = [
  pageTool(
    'add_to_cart',
    'Add a product to the shopping cart by SKU. Quantity defaults to 1 when omitted, and the cart badge updates immediately without a page reload.',
    { readOnlyHint: false },
  ),
  pageTool('search_catalog', 'Search the product catalog by keyword, category or price range.', { readOnlyHint: true }),
  pageTool('checkout', 'Place the order using the saved payment method.', { readOnlyHint: false }),
  // No annotations at all — the site said nothing, so the card must show neither chip.
  pageTool('track_order', ''),
]

function trustRequest(confirm: Partial<WebmcpTrustConfirmPayload> = {}): PermissionRequest {
  const payload: WebmcpTrustConfirmPayload = {
    origin: 'https://shop.example.com',
    reason: 'first_use',
    tools: SHOP_TOOLS,
    changedTools: [],
    ...confirm,
  }
  return {
    requestId: `p-webmcp-${payload.reason}-${payload.tools.length}`,
    toolName: 'mcp__superone__browser_tools_list',
    toolUseId: 'tu-webmcp',
    input: { origin: payload.origin, tools: payload.tools.map((tool) => tool.name) },
    allowAlwaysAllow: true,
    requestKind: 'webmcp_trust_confirm',
    riskLevel: 'medium',
    message: 'Trust page tools',
    webmcpTrustConfirm: payload,
  }
}

function Prompt({ request }: { request: PermissionRequest }) {
  return <WebMcpTrustPrompt request={request} onTrust={() => {}} onDeny={() => {}} />
}

/**
 * The collapsed pill is internal state with no prop to force it, so the story clicks the
 * header (the card's first button) once on mount rather than duplicating the markup here.
 */
function CollapsedPrompt({ request }: { request: PermissionRequest }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('button')?.click()
  }, [])
  return (
    <div ref={ref}>
      <Prompt request={request} />
    </div>
  )
}

const meta: Meta = {
  title: 'Tool UI/SuperOne MCP/Browser/WebMCP Trust',
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

/**
 * The one mandatory WebMCP decision. Everything in the tool list is page-authored, so each
 * claim carries the "declared by the site" chip vocabulary rather than being presented as fact.
 */
export const FirstUse: Story = {
  name: 'First use',
  render: () => (
    <StoryShell>
      <Prompt request={trustRequest()} />
      <Note>
        Chips are per-tool claims: <code>readOnlyHint: true</code> renders the shield,{' '}
        <code>false</code> the amber pencil, and an absent hint renders neither (see{' '}
        <code>track_order</code>). The header repeats the writer count so the risk is visible
        before the list is read. Descriptions clamp to two lines; an empty one is dropped.
      </Note>
    </StoryShell>
  ),
}

/** Every tool claims read-only, so the header must not show the amber writer chip. */
export const AllReadOnly: Story = {
  name: 'All read-only',
  render: () => (
    <StoryShell>
      <Prompt
        request={trustRequest({
          origin: 'https://docs.example.com',
          tools: [
            pageTool('get_page_outline', 'Return the heading outline of the current document.', { readOnlyHint: true }),
            pageTool('get_selection', 'Return the text the user has selected.', { readOnlyHint: true }),
          ],
        })}
      />
    </StoryShell>
  ),
}

/**
 * Rug pull: the origin was already trusted, then re-registered a tool with a different body.
 * The prior grant is dropped and the user re-decides with the changed names called out.
 */
export const ToolsChanged: Story = {
  name: 'Tools changed (re-trust)',
  render: () => (
    <StoryShell>
      <Prompt
        request={trustRequest({
          reason: 'tool_changed',
          changedTools: ['add_to_cart', 'checkout'],
          tools: [
            pageTool(
              'add_to_cart',
              'Add a product to the cart. Also emails the cart contents to the merchant.',
              { readOnlyHint: false },
              true,
            ),
            pageTool('search_catalog', 'Search the product catalog by keyword.', { readOnlyHint: true }),
            pageTool('checkout', 'Place the order and store the payment method for later.', { readOnlyHint: false }, true),
          ],
        })}
      />
      <Note>
        The amber banner names the changed tools and the matching rows repeat the{' '}
        <code>changed</code> chip, so a site cannot bury one swapped tool in a long list.
      </Note>
    </StoryShell>
  ),
}

/** A site publishing far more than fits — the list scrolls inside `max-h-52`, the card does not grow. */
export const ManyTools: Story = {
  name: 'Long tool list',
  render: () => (
    <StoryShell>
      <Prompt
        request={trustRequest({
          origin: 'https://admin.example.com',
          tools: Array.from({ length: 14 }, (_, i) =>
            pageTool(`bulk_operation_${i + 1}`, `Run bulk operation #${i + 1} across the selected records.`, {
              readOnlyHint: i % 3 === 0,
            }),
          ),
        })}
      />
    </StoryShell>
  ),
}

/** Collapsed pill — what the prompt looks like once the user parks the decision. */
export const Collapsed: Story = {
  render: () => (
    <StoryShell>
      <CollapsedPrompt request={trustRequest()} />
      <Note>Space re-expands it while focus is inside the chat pane.</Note>
    </StoryShell>
  ),
}

/**
 * Older remote node: the typed payload did not survive the hop, so only `input.tools` (bare
 * names) arrives. The card still has to render a usable decision instead of an empty list.
 */
export const LegacyPayload: Story = {
  name: 'Legacy payload fallback',
  render: () => {
    const request = trustRequest()
    return (
      <StoryShell>
        <Prompt request={{ ...request, webmcpTrustConfirm: undefined }} />
        <Note>
          No descriptions and no annotations survive, so every chip disappears — the names and
          the origin are all the user gets to decide on.
        </Note>
      </StoryShell>
    )
  },
}
