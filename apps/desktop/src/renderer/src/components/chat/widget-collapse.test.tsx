/** @vitest-environment jsdom */

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableToolRow } from '@superone/chat-view/PortableToolRow'
import { ToolBlock } from './ToolBlock'

/**
 * A code widget folds like an MCP App View: a pinned header with the widget glyph before
 * its title, and the title or the trailing chevron fold it into a tool row and back. The
 * frame stays mounted while folded, so the widget keeps its state.
 */
const TOOL = 'mcp__superone__widget_show'
const INPUT = JSON.stringify({ title: 'release_chart', widget_code: '<div>Release chart</div>' })
const ACK = 'Rendered widget "release_chart".'

const surfaces = {
  desktop: () => render(<ToolBlock toolName={TOOL} toolUseId="w" input={INPUT} status="complete" result={ACK} />),
  phone: () => render(<PortableToolRow toolName={TOOL} toolUseId="w" input={INPUT} status="complete" result={ACK} />),
}

describe.each(Object.entries(surfaces))('a widget on the %s', (_, renderWidget) => {
  it('shows its title after the widget glyph in a pinned header', () => {
    const { container } = renderWidget()
    const header = container.querySelector<HTMLElement>('[data-embedded-tool-header]')!
    expect(header.textContent).toContain('release chart')
    expect(header.querySelector('[data-embedded-tool-title] .lucide-layout-dashboard')).not.toBeNull()
    expect(header.className).not.toContain('opacity-0')
  })

  it('folds into a tool row and back from its title and its chevron, keeping the frame', () => {
    const { container } = renderWidget()
    const header = () => container.querySelector<HTMLElement>('[data-embedded-tool-header]')!
    const body = () => container.querySelector<HTMLElement>('[data-embedded-tool-body]')!
    const frame = container.querySelector('iframe')
    expect(header().dataset.collapsed).toBeUndefined()

    fireEvent.click(container.querySelector('[data-embedded-tool-title]')!)
    expect(header().dataset.collapsed).toBe('true')
    expect(body().dataset.collapsed).toBe('true')
    expect(body().hasAttribute('inert')).toBe(true)
    expect(container.querySelector('iframe')).toBe(frame)

    fireEvent.click(container.querySelector('[data-embedded-tool-toggle]')!)
    expect(header().dataset.collapsed).toBeUndefined()
    expect(body().hasAttribute('inert')).toBe(false)
    expect(container.querySelector('iframe')).toBe(frame)
  })
})
