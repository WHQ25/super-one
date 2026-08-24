/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComputerResultView } from './computer-result-view'

const OUTLINE = [
  'outline[3]{ref,depth,role,name,value,x,y,w,h,can,state}:',
  '  @e1,0,window,Kimi,"",0,0,1300,800,focus,""',
  '  @e13,7,radioButton,Work,"1",10,50,110,32,press,""',
  '  @e14,7,radioButton,Chat,"0",120,50,110,32,press,""',
].join('\n')

function payload(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    stateId: 'S1',
    root: { app: 'Kimi', bundleId: 'com.moonshot.kimichat', title: 'Kimi Agent' },
    outline: OUTLINE,
    truncation: { nodesOmitted: 0 },
    mode: 'fused',
    ...extra,
  })
}

describe('ComputerResultView', () => {
  it('shows the key fields as text, with no JSON punctuation around them', () => {
    const { container } = render(<ComputerResultView text={payload()} />)
    const text = container.textContent ?? ''
    expect(text).toContain('Kimi Agent')
    expect(text).toContain('S1')
    expect(text).toContain('fused')
    // The summary is prose, not a serialized object.
    expect(text).not.toContain('"stateId"')
  })

  it('keeps the tree folded until asked for', async () => {
    const { container } = render(<ComputerResultView text={payload()} />)
    expect(container.textContent).not.toContain('@e13')

    await userEvent.click(screen.getByText('UI Structure'))
    const text = container.textContent ?? ''
    expect(text).toContain('@e13,7,radioButton,Work')
    // The giveaway for the old one-line rendering: the escape surviving into DOM.
    expect(text).not.toContain('\\n')
  })

  it('advertises how big the tree is before it is opened', () => {
    render(<ComputerResultView text={payload()} />)
    expect(screen.getByText('3 nodes')).toBeInTheDocument()
  })

  it('keeps the raw envelope available but folded, and without the outline in it', async () => {
    const { container } = render(<ComputerResultView text={payload()} />)
    expect(container.textContent).not.toContain('"mode"')

    await userEvent.click(screen.getByText('Raw Result'))
    const text = container.textContent ?? ''
    expect(text).toContain('"stateId"')
    // The outline lives in its own section; it must not be duplicated here.
    expect(text).not.toContain('outline[3]')
  })

  it('falls back to plain JSON when the payload carries no table', () => {
    const { container } = render(
      <ComputerResultView text={JSON.stringify({ stateId: 'S1', outcome: 'worked' })} />,
    )
    expect(container.textContent).toContain('Worked')
    expect(screen.queryByText('UI Structure')).not.toBeInTheDocument()
  })

  it('falls back when the payload is not JSON at all', () => {
    const { container } = render(<ComputerResultView text="APP_NOT_FOUND: no such app" />)
    expect(container.textContent).toContain('APP_NOT_FOUND')
  })
})
