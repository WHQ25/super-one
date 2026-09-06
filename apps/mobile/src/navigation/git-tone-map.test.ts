import { describe, expect, it } from 'vitest'
import { buildGitToneMap } from './use-project-git-status'

describe('git colours in the file browser', () => {
  const tones = buildGitToneMap([
    { path: 'apps/mobile/src/runtime.ts', index: null, worktree: 'M' },
    { path: 'apps/mobile/src/new.ts', index: 'A', worktree: null },
    { path: 'docs/gone.md', index: 'D', worktree: null },
  ])

  it('keys files by the repo-relative path git reports', () => {
    expect(tones.files.get('apps/mobile/src/runtime.ts')?.tone).toBe('modified')
    expect(tones.files.get('apps/mobile/src/runtime.ts')?.staged).toBe(false)
    expect(tones.files.get('apps/mobile/src/new.ts')?.staged).toBe(true)
  })

  // A change three levels down still has to reach the folder the user is looking at.
  it('carries a change up to every folder above it', () => {
    expect(tones.directories.get('apps')).toBe('modified')
    expect(tones.directories.get('apps/mobile')).toBe('modified')
    expect(tones.directories.get('apps/mobile/src')).toBe('modified')
  })

  it('gives a folder the loudest tone under it, not the first one seen', () => {
    const mixed = buildGitToneMap([
      { path: 'src/a.ts', index: 'A', worktree: null },
      { path: 'src/b.ts', index: 'D', worktree: null },
    ])
    expect(mixed.directories.get('src')).toBe('deleted')
  })

  it('leaves untouched folders uncoloured', () => {
    expect(tones.directories.get('packages')).toBeUndefined()
  })
})
