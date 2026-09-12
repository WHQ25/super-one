import { describe, expect, it, vi } from 'vitest'

vi.mock('./media-gen/paths', () => ({
  mediaGenOutputRoot: () => '/userData/media-gen/outputs',
}))
vi.mock('./recent-folders', () => ({
  getRecentFolders: () => [{ path: '/projects/app' }],
}))
vi.mock('./session/session-repo', () => ({
  listWorktreePaths: () => ['/projects/app/.worktrees/x'],
}))
vi.mock('./path-security', () => ({
  getReadableAssetRoots: (projectRoots: string[]) => [
    ...projectRoots,
    '/Users/alice/.grok/sessions',
  ],
}))

vi.mock('electron', () => ({ app: { getPath: () => '/userData' } }))
import { builtInCaptureRoots, RECORDING_ROOT } from './media-output-paths'

import { getMediaReadableRoots } from './media-readable-roots'

describe('getMediaReadableRoots', () => {
  it('includes SuperOne-owned media roots so restored media is not 403d', () => {
    expect(getMediaReadableRoots()).toEqual([
      '/projects/app',
      '/projects/app/.worktrees/x',
      '/userData/media-gen/outputs',
      // Screenshots and action recordings both live under the temp roots.
      ...builtInCaptureRoots(),
      // Still readable: transcripts saved before the move link recordings here.
      '/userData/recordings',
      '/Users/alice/.grok/sessions',
    ])
  })

  it('keeps recordings saved under the old userData root playable after the move to temp', () => {
    const roots = getMediaReadableRoots()
    expect(roots).toContain('/userData/recordings')
    expect(roots).toContain(RECORDING_ROOT)
  })
})
