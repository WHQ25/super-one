/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitDirtyStatus } from '@superone/shared/agent-types'
import { WorktreeHandoffSection } from './WorktreeHandoffSection'

let deferred: { resolve: (s: GitDirtyStatus | null) => void; promise: Promise<GitDirtyStatus | null> }
let realApp: unknown

function defer() {
  let resolve!: (s: GitDirtyStatus | null) => void
  const promise = new Promise<GitDirtyStatus | null>((r) => { resolve = r })
  return { resolve, promise }
}

beforeEach(() => {
  deferred = defer()
  realApp = (window as unknown as Record<string, unknown>).app
  ;(window as unknown as Record<string, unknown>).app = {
    getHandoffPreview: () => deferred.promise,
    handoffToLocal: () => Promise.resolve({ ok: true }),
  }
})

afterEach(() => {
  ;(window as unknown as Record<string, unknown>).app = realApp
  vi.clearAllMocks()
})

describe('WorktreeHandoffSection loading state', () => {
  it('shows the handoff button disabled while the preview is still loading', () => {
    render(<WorktreeHandoffSection worktreePath="/wt" onDone={() => {}} />)

    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
    expect(button).toBeDisabled()
  })

  it('enables the button once the preview reports changes', async () => {
    render(<WorktreeHandoffSection worktreePath="/wt" onDone={() => {}} />)

    await act(async () => {
      deferred.resolve({ files: 2, insertions: 5, deletions: 1 })
      await deferred.promise
    })

    expect(screen.getByRole('button')).toBeEnabled()
  })

  it('keeps the button disabled and shows no stat line when there is nothing to hand off', async () => {
    render(<WorktreeHandoffSection worktreePath="/wt" onDone={() => {}} />)

    await act(async () => {
      deferred.resolve({ files: 0, insertions: 0, deletions: 0 })
      await deferred.promise
    })

    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.queryByText('clean')).toBeNull()
  })
})
