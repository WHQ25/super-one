/** @vitest-environment jsdom */

import { act, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PortableToolRow } from '@superone/chat-view/PortableToolRow'
import { TranscriptStateProvider } from '@superone/ui/lib/transcript-state'
import { ToolBlock } from './ToolBlock'
import { VirtualTranscriptBlock } from './VirtualTranscriptBlock'
import { VirtualTranscriptContext } from './virtual-transcript-context'

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

describe('a widget inside a virtual transcript', () => {
  function mount(children: ReactNode) {
    let visible: (value: boolean) => void = () => {}
    const view = render(
      <TranscriptStateProvider values={new Map()} scope="turn">
        <VirtualTranscriptContext.Provider value={{
          viewportRef: { current: null },
          preserveBlockAnchor: vi.fn(),
          observeBlock: (_node, callback) => { visible = callback; return () => {} },
        }}>
          <VirtualTranscriptBlock cacheKey="widget" estimate={48}>{children}</VirtualTranscriptBlock>
        </VirtualTranscriptContext.Provider>
      </TranscriptStateProvider>,
    )
    act(() => visible(true))
    return { ...view, reload: () => { act(() => visible(false)); act(() => visible(true)) } }
  }

  it('stays folded after scrolling unloads and reloads it', () => {
    const { container, reload } = mount(
      <ToolBlock toolName={TOOL} toolUseId="w" input={INPUT} status="complete" result={ACK} />,
    )
    fireEvent.click(container.querySelector('[data-embedded-tool-title]')!)
    expect(container.querySelector('[data-embedded-tool-header]')!.dataset.collapsed).toBe('true')

    reload()

    expect(container.querySelector('[data-embedded-tool-header]')!.dataset.collapsed).toBe('true')
  })

  it('keeps a sibling with the same title open', () => {
    const twin = JSON.stringify({ title: 'release_chart', widget_code: '<div>Other chart</div>' })
    const { container, reload } = mount(
      <>
        <ToolBlock toolName={TOOL} toolUseId="w-a" input={INPUT} status="complete" result={ACK} />
        <ToolBlock toolName={TOOL} toolUseId="w-b" input={twin} status="complete" result={ACK} />
      </>,
    )
    const headers = () => [...container.querySelectorAll<HTMLElement>('[data-embedded-tool-header]')]
    fireEvent.click(headers()[0].querySelector('[data-embedded-tool-title]')!)
    expect(headers()[0].dataset.collapsed).toBe('true')
    expect(headers()[1].dataset.collapsed).toBeUndefined()

    reload()

    expect(headers()[0].dataset.collapsed).toBe('true')
    expect(headers()[1].dataset.collapsed).toBeUndefined()
  })
})
