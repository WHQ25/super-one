/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CodexSessionIcon } from '@superone/ui/components/harness/CodexSessionIcon'
import { RealtimeStartingSurface } from './RealtimeStartingSurface'

describe('RealtimeStartingSurface', () => {
  it('breathes the Codex mark instead of spinning it', () => {
    const { container } = render(<RealtimeStartingSurface />)

    expect(container.querySelector('.codex-session-pulse')).not.toBeNull()
    expect(container.querySelector('.codex-session-rotate')).toBeNull()
  })

  it('fills its parent so the mark sits on the vertical centre', () => {
    const { container } = render(<RealtimeStartingSurface />)

    const surface = container.querySelector('[data-testid="realtime-starting-surface"]')
    expect(surface).toHaveClass('h-full', 'justify-center')
  })

  it('swaps the shell prompt for a waveform so the mark reads as voice', () => {
    const { container } = render(<RealtimeStartingSurface />)

    expect(container.querySelector('.lucide-audio-lines')).not.toBeNull()
    // The `/_` prompt belongs to command work and must not appear here.
    expect(container.querySelector('.codex-session-cursor-run')).toBeNull()
  })

  it('leaves the running session icon carrying its prompt glyph', () => {
    const { container } = render(<CodexSessionIcon status="running" />)

    expect(container.querySelector('.codex-session-rotate')).not.toBeNull()
    expect(container.querySelector('.codex-session-cursor-run')).not.toBeNull()
  })

  it('announces that the call is connecting', () => {
    render(<RealtimeStartingSurface />)

    expect(screen.getByText('Connecting voice…')).toBeInTheDocument()
  })
})
