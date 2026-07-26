import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitRun } from './git-run'

const trash: string[] = []

afterEach(() => {
  for (const dir of trash.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-run-'))
  trash.push(dir)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(dir, 'a.txt'), 'hello\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  return dir
}

/** Make the index's cached stat data stale, so a plain `git status` rewrites it. */
function staleIndex(dir: string): number {
  const past = new Date(Date.now() - 86_400_000)
  utimesSync(join(dir, 'a.txt'), past, past)
  return statSync(join(dir, '.git', 'index')).mtimeMs
}

describe('gitRun index locking', () => {
  it('leaves .git/index untouched on a read, so polling cannot churn index.lock', async () => {
    const dir = makeRepo()
    const before = staleIndex(dir)
    await gitRun(dir, ['status', '--porcelain', '-uall'])
    expect(statSync(join(dir, '.git', 'index')).mtimeMs).toBe(before)
  })

  it('still lets a write command take the index lock', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'b.txt'), 'new\n')
    const before = statSync(join(dir, '.git', 'index')).mtimeMs
    await gitRun(dir, ['add', '-A'])
    expect(statSync(join(dir, '.git', 'index')).mtimeMs).not.toBe(before)
  })
})

describe('gitRun failure reporting', () => {
  it('attaches stderr and argv to the rejection so callers can log the real reason', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-run-'))
    trash.push(dir)
    const err = await gitRun(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.stderr).toMatch(/not a git repository/i)
    expect(err.gitArgs).toEqual(['rev-parse', '--abbrev-ref', 'HEAD'])
  })

  it('rejects with a timeout marker instead of hanging when a read exceeds its budget', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-run-'))
    trash.push(dir)
    // `git help --all` is harmless; a 1ms budget guarantees the kill path runs.
    const err = await gitRun(dir, ['help', '--all'], undefined, { timeoutMs: 1 }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.gitTimedOut).toBe(true)
    expect(err.message).toContain('timed out after 1ms')
  })
})
