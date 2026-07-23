/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProviderLabel } from './ProviderLabel'

describe('ProviderLabel', () => {
  it('matches built-in provider sizing for compact custom-provider labels', () => {
    const { container } = render(
      <ProviderLabel brandKey="custom" fallback="AIYun Router Codex" size={12} compactFallback />,
    )

    expect(screen.getByText('AIYun Router Codex')).toHaveStyle({ fontSize: '9px' })
    expect(container.querySelector('svg')).toHaveStyle({ width: '12px', height: '12px' })
  })
})
