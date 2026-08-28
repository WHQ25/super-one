/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MessageErrorBadge } from './MessageErrorBadge'

describe('MessageErrorBadge', () => {
  it('limits expanded error details to a scrollable height', () => {
    render(<MessageErrorBadge info={{ raw: 'long accumulated error log' }} />)

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('long accumulated error log').parentElement)
      .toHaveClass('max-h-72', 'overflow-y-auto', 'overscroll-contain')
  })
})
