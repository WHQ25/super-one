import { describe, expect, it, vi } from 'vitest'

vi.mock('./media-gen/paths', () => ({
  mediaGenRoot: () => '/userData/media-gen',
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

import { getMediaReadableRoots } from './media-readable-roots'

describe('getMediaReadableRoots', () => {
  it('includes media-gen output so restored gallery videos are not 403d', () => {
    expect(getMediaReadableRoots()).toEqual([
      '/projects/app',
      '/projects/app/.worktrees/x',
      '/userData/media-gen',
      '/Users/alice/.grok/sessions',
    ])
  })
})
