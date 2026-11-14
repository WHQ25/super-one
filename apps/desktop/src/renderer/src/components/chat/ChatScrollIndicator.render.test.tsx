/** @vitest-environment jsdom */

import { useRef } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChatScrollIndicator } from './ChatScrollIndicator'
import type { TurnOutlineEntry } from './turn-outline'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function makeEntries(count: number): TurnOutlineEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `turn-${index + 1}`,
    index,
    text: `Turn ${index + 1}`,
    createdAt: '2026-11-14T12:00:00.000Z',
  }))
}

function Harness({ count }: { count: number }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  return (
    <div>
      <div ref={viewportRef} />
      <ChatScrollIndicator entries={makeEntries(count)} viewportRef={viewportRef} onJump={vi.fn()} />
    </div>
  )
}

describe('ChatScrollIndicator', () => {
  it('uses scroll-edge-fade-y mask instead of opaque card fade overlays', () => {
    const { container } = render(<Harness count={40} />)
    const rail = container.querySelector('[data-chat-scroll-indicator]')
    expect(rail).not.toBeNull()
    expect(rail!.querySelector('[data-mod-edge-fade]')).toBeNull()
    expect(rail!.querySelector('.from-card')).toBeNull()
    const scroller = rail!.querySelector('.scroll-edge-fade-y')
    expect(scroller).not.toBeNull()
    expect(scroller).toHaveClass('hide-scrollbar', 'overflow-y-auto')
    expect(scroller!.querySelectorAll('[data-tick]')).toHaveLength(40)
  })
})
