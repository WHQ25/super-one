import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}))

vi.mock('child_process', () => ({
  execFileSync: execFileSyncMock,
}))

import { resolveProjectPath } from './project-path'

describe('resolveProjectPath', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset()
  })

  it('returns normalized absolute path for non-git folders', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo')
    })

    expect(resolveProjectPath('.')).toBe(realpathSync(resolve('.')))
  })

  it('returns git toplevel for subdirectories in repos', () => {
    const repoRoot = resolve('/tmp/super-one-repo')
    execFileSyncMock.mockReturnValue(`${repoRoot}\n`)

    expect(resolveProjectPath('/tmp/super-one-repo/packages/app')).toBe(repoRoot)
  })

  it('falls back to absolute path when normalization fails', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('git error')
    })

    const input = `./__missing_${Date.now()}_${Math.random().toString(36).slice(2)}`

    expect(resolveProjectPath(input)).toBe(resolve(input))
  })
})
