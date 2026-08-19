/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SessionTitleAnimated } from './AnimatedSessionTitle'

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: { agentTitles: Record<string, string> }) => unknown) =>
    selector({ agentTitles: {} }),
}))

const TITLE = 'a session title long enough to be truncated in the sidebar'

describe('sidebar session title — stall color repaint', () => {
  it('recreates the truncating element when the stall color changes', () => {
    // Chromium keeps painting the old color on the `text-overflow: ellipsis`
    // glyph after a color-only change, so a recovered session showed white text
    // with a red "…" until the row was hovered. The keyed remount is the fix.
    const { container, rerender } = render(
      <SessionTitleAnimated sessionId="s1" fallback={TITLE} className="text-red-500" />,
    )
    const before = container.querySelector('.animated-title-inner')

    rerender(<SessionTitleAnimated sessionId="s1" fallback={TITLE} className="" />)

    expect(container.querySelector('.animated-title-inner')).not.toBe(before)
  })

  it('keeps the same element while the color is unchanged', () => {
    const { container, rerender } = render(
      <SessionTitleAnimated sessionId="s1" fallback={TITLE} className="text-red-500" />,
    )
    const before = container.querySelector('.animated-title-inner')

    rerender(<SessionTitleAnimated sessionId="s1" fallback={TITLE} className="text-red-500" />)

    expect(container.querySelector('.animated-title-inner')).toBe(before)
  })
})
