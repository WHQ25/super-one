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
import { builtInCaptureRoots, RECORDING_ROOT, syncZoneRoot } from './media-output-paths'

import { getMediaReadableRoots } from './media-readable-roots'

describe('getMediaReadableRoots', () => {
  it('includes SuperOne-owned media roots so restored media is not 403d', () => {
    expect(getMediaReadableRoots()).toEqual([
      '/projects/app',
      '/projects/app/.worktrees/x',
      // Every session artifact — captures, generations, agent deliverables — lives here now.
      '/userData/sync',
      // Legacy: generations and captures written before the sync zone existed.
      '/userData/media-gen/outputs',
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

  it('keeps every legacy capture and generation root readable after artifacts moved to the sync zone', () => {
    const roots = getMediaReadableRoots()
    expect(roots).toContain(syncZoneRoot())
    // A transcript saved before the move links its screenshot under the temp root and its
    // generated image under media-gen/outputs; neither may start 403ing.
    for (const legacy of [...builtInCaptureRoots(), '/userData/media-gen/outputs']) expect(roots).toContain(legacy)
  })
})
