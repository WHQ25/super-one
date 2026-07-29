/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalCommandOutput } from './TerminalCommandOutput'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TerminalCommandOutput', () => {
  it('clamps command and output until their content is expanded', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100)

    render(
      <TerminalCommandOutput command={'first line\nsecond line\nthird line\nfourth line'} hasOutput outputVersion="long output">
        <div>long output</div>
      </TerminalCommandOutput>,
    )

    const command = screen.getByTitle('Show full command')
    expect(command).toHaveClass('line-clamp-3')
    fireEvent.click(command)
    expect(screen.getByTitle('Collapse command')).not.toHaveClass('line-clamp-3')

    const output = screen.getByTitle('Show full output')
    expect(output).toHaveClass('max-h-72', 'overflow-y-auto')
    fireEvent.keyDown(output, { key: 'Enter' })
    expect(screen.getByTitle('Collapse output')).toHaveClass('overflow-y-visible')
    expect(screen.getByTitle('Collapse output')).not.toHaveClass('max-h-72')
  })
})
