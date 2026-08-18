/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorktreeForkSection } from './WorktreeForkSection'

const { switchSessionMock } = vi.hoisted(() => ({
  switchSessionMock: vi.fn(async () => {}),
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: { getState: () => ({ switchSession: switchSessionMock }) },
}))

let realApp: unknown
const forkSessionMock = vi.fn(async () => ({ ok: true as const, sessionId: 'forked-session' }))

beforeEach(() => {
  realApp = (window as unknown as Record<string, unknown>).app
  ;(window as unknown as Record<string, unknown>).app = {
    getGitInfo: vi.fn(async () => ({ dirty: { files: 2, insertions: 5, deletions: 1 } })),
    forkSession: forkSessionMock,
  }
})

afterEach(() => {
  ;(window as unknown as Record<string, unknown>).app = realApp
  vi.clearAllMocks()
})

describe('WorktreeForkSection local changes', () => {
  it('lets the user exclude local changes from the new worktree', async () => {
    render(<WorktreeForkSection sessionId="source-session" cwd="/repo" onForked={() => {}} />)

    const carryChanges = await screen.findByRole('checkbox', { name: /carry local changes/i })
    expect(carryChanges).toBeChecked()

    fireEvent.click(carryChanges)
    expect(carryChanges).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: /fork session/i }))

    await waitFor(() => {
      expect(forkSessionMock).toHaveBeenCalledWith({
        sessionId: 'source-session',
        mode: 'worktree',
        carryLocalChanges: false,
      })
    })
  })
})
