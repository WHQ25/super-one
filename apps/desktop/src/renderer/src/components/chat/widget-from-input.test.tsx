/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CodexMcpToolCallItem } from '@superone/shared/agent-types'
import { ToolBlock } from './ToolBlock'
import { renderCodexItem } from './codex-item-renderer'
import { NestedToolContext } from './nested-tool-context'

/**
 * A `widget_code` call can come back with only the short acknowledgement the model read.
 * The desktop then draws the widget from the call's own input, on every path that reaches
 * the widget branch, and only once the call received a successful result.
 */
const WIDGET = 'mcp__superone__widget_show'
const ARGS = { title: 'releases', widget_code: '<div id="chart">Release chart</div>', data: { builds: 3 } }
const INPUT = JSON.stringify(ARGS)
const PARTIAL_INPUT = '{"title":"releases","widget_code":"<div>Rel'
const ACK = 'Rendered widget "releases".'

function widgetDocument(container: HTMLElement): string | null {
  return container.querySelector('iframe')?.getAttribute('srcdoc') ?? null
}

function codexWidget(overrides: Partial<CodexMcpToolCallItem> = {}): CodexMcpToolCallItem {
  return {
    type: 'mcp_tool_call',
    id: 'codex-widget',
    server: 'superone',
    tool: 'widget_show',
    arguments: ARGS,
    status: 'completed',
    result: { content: [{ type: 'text', text: ACK }], structuredContent: null },
    ...overrides,
  }
}

describe('a desktop widget drawn from its call input', () => {
  it('draws a Claude call whose result is only the acknowledgement, with its data', () => {
    const { container } = render(<ToolBlock toolName={WIDGET} toolUseId="w" input={INPUT} status="complete" result={ACK} />)
    expect(widgetDocument(container)).toContain('Release chart')
    expect(widgetDocument(container)).toContain('{data:{"builds":3}}')
  })

  it('keeps drawing the payload an older result carries', () => {
    const stored = JSON.stringify({ title: 'releases', widget_code: '<div>Stored payload</div>', width: 800, height: 600, isSVG: false })
    const { container } = render(<ToolBlock toolName={WIDGET} toolUseId="w" input={INPUT} status="complete" result={stored} />)
    expect(widgetDocument(container)).toContain('Stored payload')
    expect(widgetDocument(container)).not.toContain('Release chart')
  })

  it('mounts the frame once the input is complete, while the host still waits for it', () => {
    const { container } = render(<ToolBlock toolName={WIDGET} toolUseId="w" input={INPUT} status="streaming" />)
    expect(widgetDocument(container)).toContain('Release chart')
  })

  it('previews a partial input in the widget block while the code streams', () => {
    const { container } = render(
      <ToolBlock toolName={WIDGET} toolUseId="w" input={PARTIAL_INPUT} status="streaming" />,
    )
    expect(container.textContent).toContain('releases')
    expect(container.textContent).not.toContain('Generating widget')
  })

  it('keeps the widget of a call interrupted after its input was complete', () => {
    const { container } = render(<ToolBlock toolName={WIDGET} toolUseId="w" input={INPUT} status="complete" />)
    expect(widgetDocument(container)).toContain('Release chart')
  })

  it('keeps the ordinary row, with the widget glyph, for a call interrupted while its input streamed', () => {
    const { container } = render(<ToolBlock toolName={WIDGET} toolUseId="w" input={PARTIAL_INPUT} status="complete" />)
    expect(widgetDocument(container)).toBeNull()
    expect(container.textContent).toContain('widget show')
    expect(container.textContent).not.toContain('Widget Generated')
    expect(container.querySelector('.lucide-layout-dashboard')).not.toBeNull()
  })

  it('keeps the error and denied rows, which say why', () => {
    const failed = render(<ToolBlock toolName={WIDGET} toolUseId="w" input={INPUT} status="complete" result="widget_show failed." isError />)
    expect(widgetDocument(failed.container)).toBeNull()
    expect(failed.container.querySelector('.errored')).not.toBeNull()
    const denied = render(<ToolBlock toolName={WIDGET} toolUseId="w" input={INPUT} status="complete" result="[denied] Not now" isError />)
    expect(widgetDocument(denied.container)).toBeNull()
    expect(denied.container.querySelector('.denied')).not.toBeNull()
  })

  it('keeps a subagent card to its summary row and draws the widget in the full view', () => {
    const block = <ToolBlock toolName={WIDGET} toolUseId="w" input={INPUT} status="complete" result={ACK} />
    const card = render(<NestedToolContext.Provider value={{ allowExpand: false }}>{block}</NestedToolContext.Provider>)
    expect(widgetDocument(card.container)).toBeNull()
    expect(card.container.textContent).toContain('releases')
    expect(card.container.querySelector('.lucide-layout-dashboard')).not.toBeNull()
    const fullView = render(<NestedToolContext.Provider value={{ allowExpand: true }}>{block}</NestedToolContext.Provider>)
    expect(widgetDocument(fullView.container)).toContain('Release chart')
  })

  it.each([
    ['object', ARGS],
    ['string', INPUT],
  ])('draws a Codex item whose arguments are a serialized %s', (_, args) => {
    const { container } = render(<>{renderCodexItem(codexWidget({ arguments: args }), 0, false)}</>)
    expect(widgetDocument(container)).toContain('Release chart')
  })

  it('shows a Codex tool error reply as an error row, not a widget', () => {
    const { container } = render(<>{renderCodexItem(codexWidget({
      result: { content: [{ type: 'text', text: 'widget_show failed.' }], structuredContent: null, isError: true },
    }), 0, false)}</>)
    expect(widgetDocument(container)).toBeNull()
    expect(container.querySelector('.errored')).not.toBeNull()
  })
})
