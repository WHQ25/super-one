/** @vitest-environment jsdom */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CompactingIndicator } from './ChatMessage'

describe('CompactingIndicator', () => {
  it('counts from the session-recorded start, not from mount', () => {
    // Remounting is what switching sessions and back does; the elapsed time has
    // to come from the compaction, not from this render.
    render(<CompactingIndicator startedAt={Date.now() - 17_000} />)
    expect(screen.getByText('17s')).toBeInTheDocument()
  })

  it('falls back to mount time when no start is provided', () => {
    render(<CompactingIndicator />)
    expect(screen.queryByText(/^\d+s$/)).toBeNull()
  })
})
