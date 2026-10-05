/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrowserToolBlockPresenter } from '@superone/chat-view/presenters/BrowserToolBlock'
import { getBrowserOp } from './browser-tool-display'

const mixedResult = JSON.stringify({
  screenshot: { path: '/tmp/browser.png', width: 800, height: 600 },
  page: 'title: Checkout\nelements[1]{selector}:\n  #submit',
})

describe('browser snapshot screenshots', () => {
  it.each([{ include: ['screenshot'] }, { include: ['meta', 'screenshot'] }])('shows $include with a right-hand image indicator and an expandable preview', async ({ include }) => {
    const params = { include, description: 'Inspect checkout' }
    const result = include.length === 1 ? JSON.stringify({ path: '/tmp/browser.png' }) : mixedResult
    const { container } = render(
      <BrowserToolBlockPresenter
        op={getBrowserOp('browser_snapshot', params)!}
        params={params}
        result={result}
        isStreaming={false}
        renderScreenshot={(path, label) => <img alt={label} data-path={path} />}
        renderDetail={(detail) => <pre>{detail.kind === 'mock' ? '' : detail.result}</pre>}
      />,
    )
    const header = container.querySelector('.tool-node > div') as HTMLElement
    expect(within(header).getByText('Inspect checkout')).toBeInTheDocument()
    expect(within(header).getByLabelText('Screenshot').parentElement).toHaveClass('shrink-0')
    expect(screen.queryByRole('img')).toBeNull()
    fireEvent.click(header)
    expect(screen.getByRole('img')).toHaveAttribute('data-path', '/tmp/browser.png')
    if (include.length > 1) {
      expect(container.querySelector('details pre')).toBeNull()
      fireEvent.click(screen.getByText('Result'))
      await waitFor(() => expect(container.querySelector('details pre')?.textContent).toBe(mixedResult))
    }
  })

  it.each([
    { result: 'title: Checkout', isStreaming: false, isError: false },
    { result: mixedResult, isStreaming: true, isError: false },
    { result: mixedResult, isStreaming: false, isError: true },
    { result: JSON.stringify({ screenshot: {} }), isStreaming: false, isError: false },
  ])('does not claim a screenshot when unavailable or unsuccessful: %j', (outcome) => {
    render(<BrowserToolBlockPresenter op="snapshot" params={{ description: 'Inspect checkout' }} {...outcome} />)
    expect(screen.queryByLabelText('Screenshot')).toBeNull()
  })
})
