/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ClassicBranchChip } from './ClassicBranchChip'

const props = {
  currentFolder: '/proj',
  compact: false,
  gitInfo: { branch: 'main' },
  isGitRepo: true,
  gitError: null,
  sessionGitBranch: null,
  refreshGitInfo: () => undefined,
  onInitialized: () => undefined,
}

describe('ClassicBranchChip', () => {
  it('shows the branch while the session is on the project checkout', () => {
    render(<ClassicBranchChip {...props} isInWorktree={false} />)
    expect(screen.getByTitle('main')).toBeTruthy()
  })

  it('hides the branch while a worktree chip is already showing that checkout', () => {
    render(<ClassicBranchChip {...props} isInWorktree />)
    expect(screen.queryByTitle('main')).toBeNull()
  })
})
