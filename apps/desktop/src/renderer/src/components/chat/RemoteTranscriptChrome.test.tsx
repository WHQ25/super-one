/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RemoteTranscriptChromeView } from './RemoteTranscriptChrome'

describe('RemoteTranscriptChromeView', () => {
  it('shows the summarized note and the earlier page', () => {
    const onLoadEarlier = vi.fn()
    render(<RemoteTranscriptChromeView summarized hasOlder onLoadEarlier={onLoadEarlier} />)
    expect(screen.getByText('Longer messages are summarized until expanded.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load Earlier' }))
    expect(onLoadEarlier).toHaveBeenCalledOnce()
  })

  it('shows the paging line and disables the earlier page', () => {
    render(<RemoteTranscriptChromeView paging hasOlder onLoadEarlier={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading history…')
    expect(screen.getByRole('button', { name: 'Load Earlier' })).toBeDisabled()
  })

  it('shows the resync line and nothing else when the window is gone', () => {
    render(<RemoteTranscriptChromeView resyncing />)
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing transcript…')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers a newer page at the bottom of a detached window', () => {
    const onLoadNewer = vi.fn()
    const { container } = render(<RemoteTranscriptChromeView edge="bottom" hasNewer onLoadNewer={onLoadNewer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load Newer' }))
    expect(onLoadNewer).toHaveBeenCalledOnce()
    expect(container.querySelector('[data-testid="remote-transcript-chrome-top"]')).toBeNull()
  })

  it('renders nothing when the transcript is the whole session', () => {
    const { container } = render(<RemoteTranscriptChromeView />)
    expect(container).toBeEmptyDOMElement()
  })
})
