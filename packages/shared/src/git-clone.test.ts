import { describe, expect, it } from 'vitest'
import { buildCloneArgs } from './git-clone'

const dest = '/tmp/parent/repo'

describe('buildCloneArgs', () => {
  it('keeps a full clone when shallow is omitted', () => {
    expect(
      buildCloneArgs({ remoteUrl: 'https://github.com/acme/repo.git', parentPath: '/tmp' }, dest),
    ).toEqual(['clone', '--', 'https://github.com/acme/repo.git', dest])
  })

  it('keeps a full clone when shallow is false', () => {
    expect(
      buildCloneArgs(
        { remoteUrl: 'https://github.com/acme/repo.git', parentPath: '/tmp', shallow: false },
        dest,
      ),
    ).toEqual(['clone', '--', 'https://github.com/acme/repo.git', dest])
  })

  it('inserts --depth=1 before the option terminator', () => {
    expect(
      buildCloneArgs(
        { remoteUrl: 'https://github.com/acme/repo.git', parentPath: '/tmp', shallow: true },
        dest,
      ),
    ).toEqual(['clone', '--depth=1', '--', 'https://github.com/acme/repo.git', dest])
  })
})
