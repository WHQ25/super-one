import { describe, expect, it, vi } from 'vitest'

vi.mock('./media-gen/paths', () => ({
  mediaGenOutputRoot: () => '/userData/media-gen/outputs',
}))
vi.mock('./agent/action-recording-store', () => ({
  actionRecordingDir: () => '/userData/recordings',
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
import { builtInCaptureRoots } from './media-output-paths'

import { getMediaReadableRoots } from './media-readable-roots'

describe('getMediaReadableRoots', () => {
  it('includes SuperOne-owned media roots so restored media is not 403d', () => {
    expect(getMediaReadableRoots()).toEqual([
      '/projects/app',
      '/projects/app/.worktrees/x',
      '/userData/media-gen/outputs',
      '/userData/recordings',
      ...builtInCaptureRoots('/userData'),
      '/Users/alice/.grok/sessions',
    ])
  })
})
