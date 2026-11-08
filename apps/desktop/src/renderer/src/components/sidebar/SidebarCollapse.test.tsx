/** @vitest-environment jsdom */
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SidebarCollapse } from './SidebarCollapse'

function panelOf(text: string): HTMLElement {
  return screen.getByText(text).parentElement!.parentElement as HTMLElement
}

function Harness({ unmountClosed = false, initial = false }: { unmountClosed?: boolean; initial?: boolean }) {
  const [open, setOpen] = useState(initial)
  return (
    <>
      <button type="button" onClick={() => setOpen((value) => !value)}>Toggle</button>
      <SidebarCollapse open={open} unmountClosed={unmountClosed}>
        <div>Body</div>
      </SidebarCollapse>
    </>
  )
}

describe('SidebarCollapse', () => {
  it('starts closed without mounting the body when asked to drop it', () => {
    render(<Harness unmountClosed />)
    const panel = screen.getByRole('button', { name: 'Toggle' }).nextElementSibling as HTMLElement
    expect(panel).toHaveClass('grid-rows-[0fr]', 'duration-[120ms]', 'ease-out')
    expect(panel).toHaveAttribute('inert')
    expect(screen.queryByText('Body')).toBeNull()
  })

  it('keeps a closed body mounted when it should stay, matching pinned sessions', () => {
    render(<Harness />)
    const panel = panelOf('Body')
    expect(panel).toHaveClass('grid-rows-[0fr]')
    expect(panel).toHaveAttribute('inert')
  })

  it('mounts the body and opens the row together', () => {
    render(<Harness unmountClosed />)
    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }))
    const panel = panelOf('Body')
    expect(panel).toHaveClass('grid-rows-[1fr]', 'duration-[120ms]', 'ease-out')
    expect(panel).not.toHaveAttribute('inert')
  })

  it('drops the body only after the close transition', () => {
    render(<Harness unmountClosed initial />)
    expect(screen.getByText('Body')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }))
    const panel = panelOf('Body')
    expect(panel).toHaveClass('grid-rows-[0fr]')
    fireEvent.transitionEnd(panel, { propertyName: 'grid-template-rows' })
    expect(screen.queryByText('Body')).toBeNull()
  })
})
