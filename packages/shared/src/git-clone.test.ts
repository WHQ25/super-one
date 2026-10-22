import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCloneArgs, cloneRepository, parseCloneProgress, planCloneTarget } from './git-clone'

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

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempParent(): string {
  const parent = mkdtempSync(join(tmpdir(), 'clone-plan-'))
  dirs.push(parent)
  return parent
}

describe('cloneRepository reuse-or-rename', () => {
  it('reuses a folder whose origin is the same repository', async () => {
    const parent = tempParent()
    const existing = join(parent, 'app')
    execFileSync('git', ['init', '-q', existing])
    execFileSync('git', ['-C', existing, 'remote', 'add', 'origin', 'git@github.com:acme/app.git'])
    const result = await cloneRepository({
      remoteUrl: 'https://github.com/acme/app',
      parentPath: parent,
      ifExists: 'reuse-or-rename',
    })
    expect(result).toEqual({ path: existing, name: 'app', reused: true })
  })

  it('plans the next free name when the folder is a different origin', () => {
    const parent = tempParent()
    const existing = join(parent, 'app')
    execFileSync('git', ['init', '-q', existing])
    execFileSync('git', ['-C', existing, 'remote', 'add', 'origin', 'https://github.com/other/app.git'])
    expect(planCloneTarget({
      remoteUrl: 'https://github.com/acme/app',
      parentPath: parent,
      ifExists: 'reuse-or-rename',
    })).toEqual({ directoryName: 'app-2' })
  })

  it('reuses a numbered clone whose origin matches', async () => {
    const parent = tempParent()
    execFileSync('git', ['init', '-q', join(parent, 'app')])
    execFileSync('git', ['-C', join(parent, 'app'), 'remote', 'add', 'origin', 'https://github.com/other/app.git'])
    const numbered = join(parent, 'app-2')
    execFileSync('git', ['init', '-q', numbered])
    execFileSync('git', ['-C', numbered, 'remote', 'add', 'origin', 'git@github.com:acme/app.git'])
    const result = await cloneRepository({
      remoteUrl: 'https://github.com/acme/app',
      parentPath: parent,
      ifExists: 'reuse-or-rename',
    })
    expect(result).toEqual({ path: numbered, name: 'app-2', reused: true })
  })

  it('does not reuse a plain folder inside a repository with the same origin', () => {
    const parent = tempParent()
    const repo = join(parent, 'outer')
    execFileSync('git', ['init', '-q', repo])
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/acme/app.git'])
    mkdirSync(join(repo, 'app'))
    expect(planCloneTarget({
      remoteUrl: 'https://github.com/acme/app',
      parentPath: repo,
      directoryName: 'app',
      ifExists: 'reuse-or-rename',
    })).toEqual({ directoryName: 'app-2' })
  })

  it('still rejects an existing folder when reuse is not requested', async () => {
    const parent = tempParent()
    execFileSync('git', ['init', '-q', join(parent, 'app')])
    await expect(cloneRepository({
      remoteUrl: 'https://github.com/acme/app',
      parentPath: parent,
    })).rejects.toMatchObject({ code: 'conflict' })
  })
})
