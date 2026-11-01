/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PinnedSessionEntry } from '@superone/shared/agent-types'
import { SettledSection } from './SettledSection'

const VIEWPORT_HEIGHT = 256
const ROW_HEIGHT = 32

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.slot === 'scroll-area-viewport' ? VIEWPORT_HEIGHT : ROW_HEIGHT
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240)
})

function session(index: number): PinnedSessionEntry {
  return {
    sessionId: `sid-${index}`,
    title: `Finished ${index}`,
    lastActiveAt: '2026-03-02T00:00:00.000Z',
    messageCount: 1,
    provider: 'claude',
    isSettled: true,
    folderPath: '/project-a',
    folderName: 'project-a',
  }
}

describe('SettledSection virtualizer', () => {
  it('mounts the visible window from the real virtualizer, not every loaded row', () => {
    const sessions = Array.from({ length: 40 }, (_, index) => session(index))
    render(
      <SettledSection
        folderPath="/project-a"
        sessions={sessions}
        onSwitchSession={vi.fn()}
        onPinSession={vi.fn()}
        onSettleSession={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Settled/ }))
    const mounted = document.querySelectorAll('.group\\/session').length
    expect(screen.getByText('Finished 0')).toBeInTheDocument()
    expect(screen.queryByText('Finished 39')).toBeNull()
    expect(mounted).toBeGreaterThan(0)
    expect(mounted).toBeLessThan(20)
  })
})
