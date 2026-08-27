/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TurnDetailSection } from './TurnDetailSection'

const runs = [
  { key: 'a', collapsible: true, content: <p>tools-1</p> },
  { key: 'b', collapsible: false, content: <p>markdown</p> },
  { key: 'c', collapsible: true, content: <p>tools-2</p> },
  { key: 'd', collapsible: false, content: <p>answer</p> },
]

describe('turn detail disclosure', () => {
  it('keeps pinned runs visible while every collapsible run stays unmounted', () => {
    render(<TurnDetailSection runs={runs} />)
    expect(screen.getByText('markdown')).toBeInTheDocument()
    expect(screen.getByText('answer')).toBeInTheDocument()
    expect(screen.queryByText('tools-1')).not.toBeInTheDocument()
    expect(screen.queryByText('tools-2')).not.toBeInTheDocument()
  })

  it('shows one indicator, anchored at the first collapsed run', () => {
    const { container } = render(<TurnDetailSection runs={runs} />)
    expect(container.querySelectorAll('.turn-detail-section')).toHaveLength(1)
    const children = [...container.firstElementChild!.parentElement!.children]
    expect(children[0]).toHaveClass('turn-detail-section')
  })

  it('hands the content\'s outer margins to the animating wrapper', async () => {
    const user = userEvent.setup()
    render(
      <TurnDetailSection
        runs={[
          { key: 'a', collapsible: true, content: <p style={{ marginTop: '12px', marginBottom: '8px' }}>tools</p> },
          { key: 'b', collapsible: false, content: <p>answer</p> },
        ]}
      />,
    )
    await user.click(screen.getByRole('button'))

    // The wrapper animates height, so it is a formatting context and would otherwise trap
    // these margins — they have to live on the wrapper to still collapse with neighbours.
    const region = await screen.findByTestId('turn-detail-region')
    await waitFor(() => expect(region).toHaveAttribute('data-expanded', 'true'))
    expect(region.style.marginTop).toBe('12px')
    expect(region.style.marginBottom).toBe('8px')

    const content = screen.getByText('tools')
    expect(content.style.marginTop).toBe('0px')
    expect(content.style.marginBottom).toBe('0px')
  })

  it('restores the turn order when expanded', async () => {
    const user = userEvent.setup()
    const { container } = render(<TurnDetailSection runs={runs} />)
    await user.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByText('tools-1')).toBeInTheDocument())
    const text = [...container.querySelectorAll('p')].map((p) => p.textContent)
    expect(text).toEqual(['tools-1', 'markdown', 'tools-2', 'answer'])
  })
})
