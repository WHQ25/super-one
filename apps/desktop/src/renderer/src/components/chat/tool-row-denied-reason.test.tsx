/** @vitest-environment jsdom */

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableToolRow } from '@superone/chat-view/PortableToolRow'
import { ToolBlock } from './ToolBlock'

/**
 * A denied row says so in its header and keeps the reason the user gave at the bottom of the
 * expanded row, where the other tool rows put a refusal or a failure.
 */
const TOOL = 'mcp__context7__query_docs'
const INPUT = JSON.stringify({ query: 'hooks' })
const REASON = 'Use the cached docs instead.'

const surfaces = {
  desktop: (result: string) => render(<ToolBlock toolName={TOOL} toolUseId="t" input={INPUT} status="complete" result={result} isError />),
  phone: (result: string) => render(<PortableToolRow toolName={TOOL} toolUseId="t" input={INPUT} status="complete" result={result} isError />),
}

describe.each(Object.entries(surfaces))('a denied tool row on the %s', (_, renderRow) => {
  it('shows the reason only in the expanded row, below the header', () => {
    const { container } = renderRow(`[denied] ${REASON}`)
    const header = container.querySelector<HTMLElement>('.tool-node-header')!
    expect(header.textContent).toContain('Denied')
    expect(container.textContent).not.toContain(REASON)
    fireEvent.click(header)
    expect(container.textContent).toContain(REASON)
    expect(header.textContent).not.toContain(REASON)
  })

  it('has nothing to expand for a denial without a reason', () => {
    const { container } = renderRow('[denied] User denied permission')
    expect(container.querySelector('.tool-node.cursor-pointer')).toBeNull()
  })
})
