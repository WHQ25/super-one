import { describe, expect, it } from 'vitest'
import { buildCloneArgs, parseCloneProgress } from './git-clone'

const dest = '/tmp/parent/repo'

describe('buildCloneArgs', () => {
  it('keeps a full clone when shallow is omitted', () => {
    expect(
      buildCloneArgs({ remoteUrl: 'https://github.com/acme/repo.git', parentPath: '/tmp' }, dest),
    ).toEqual(['clone', '--progress', '--', 'https://github.com/acme/repo.git', dest])
  })

  it('keeps a full clone when shallow is false', () => {
    expect(
      buildCloneArgs(
        { remoteUrl: 'https://github.com/acme/repo.git', parentPath: '/tmp', shallow: false },
        dest,
      ),
    ).toEqual(['clone', '--progress', '--', 'https://github.com/acme/repo.git', dest])
  })

  it('inserts --depth=1 before the option terminator', () => {
    expect(
      buildCloneArgs(
        { remoteUrl: 'https://github.com/acme/repo.git', parentPath: '/tmp', shallow: true },
        dest,
      ),
    ).toEqual(['clone', '--progress', '--depth=1', '--', 'https://github.com/acme/repo.git', dest])
  })
})

describe('parseCloneProgress', () => {
  it('reads the object download percent', () => {
    expect(parseCloneProgress('Receiving objects:   0% (1/2000)')).toBe(0)
    expect(parseCloneProgress('Receiving objects:  50% (1000/2000), 1.20 MiB | 2.40 MiB/s')).toBe(50)
    expect(parseCloneProgress('Receiving objects: 100% (2000/2000), 2.40 MiB | 2.40 MiB/s, done.')).toBe(100)
  })

  it('ignores other phases and non-progress lines', () => {
    expect(parseCloneProgress('Resolving deltas:  50% (300/600)')).toBeNull()
    expect(parseCloneProgress('Updating files: 100% (900/900), done.')).toBeNull()
    expect(parseCloneProgress('remote: Counting objects:  50% (10/20)')).toBeNull()
    expect(parseCloneProgress("Cloning into 'repo'...")).toBeNull()
    expect(parseCloneProgress('fatal: repository not found')).toBeNull()
  })
})
