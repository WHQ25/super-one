// @vitest-environment jsdom
import { StrictMode } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReviewFileDiff } from '@superone/shared/review-types'
import { ReviewDiffCanvas } from './ReviewDiffCanvas'

const SAMPLE_FILE: ReviewFileDiff = {
  path: 'src/demo.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  patch: [
    'diff --git a/src/demo.ts b/src/demo.ts',
    '--- a/src/demo.ts',
    '+++ b/src/demo.ts',
    '@@ -1,3 +1,3 @@',
    ' const a = 1',
    '-const b = 2',
    '+const b = 20',
    ' const c = 3',
  ].join('\n'),
  source: 'workspace-git',
}

describe('ReviewDiffCanvas', () => {
  it('mounts and unmounts cleanly in StrictMode', () => {
    const { unmount, container } = render(
      <StrictMode>
        <ReviewDiffCanvas
          file={SAMPLE_FILE}
          scope="workspace"
          workspaceRoot="/repo"
          diffStyle="split"
          lspAllowed={false}
        />
      </StrictMode>,
    )
    expect(container.querySelector('diffs-container')).not.toBeNull()
    unmount()
  })
})
