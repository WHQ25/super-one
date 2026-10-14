import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readGitPatch, untrackedFilePatch } from './git-patch'

const trash: string[] = []
afterEach(() => {
  for (const dir of trash.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' }).trim()
}

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-patch-'))
  trash.push(dir)
  git(dir, 'init', '-q')
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'first')
  return dir
}

describe('untrackedFilePatch', () => {
  it('renders a new file as an added hunk', () => {
    expect(untrackedFilePatch('n.txt', 'x\ny\n')).toBe('diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+x\n+y\n')
  })

  it('marks a missing trailing newline', () => {
    expect(untrackedFilePatch('n.txt', 'x')).toContain('+x\n\\ No newline at end of file\n')
  })

  it('renders an empty file as a header only', () => {
    expect(untrackedFilePatch('e.txt', '')).not.toContain('@@')
  })
})

describe('readGitPatch', () => {
  it('includes tracked edits and untracked files for uncommitted changes', async () => {
    const dir = repo()
    writeFileSync(join(dir, 'a.txt'), 'one\nTWO\n')
    writeFileSync(join(dir, 'new.txt'), 'fresh\n')
    const result = await readGitPatch(dir, {})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch).toContain('+TWO')
    expect(result.patch).toContain('+++ b/new.txt')
  })

  it('limits uncommitted changes to one path, relative to the caller folder', async () => {
    const dir = repo()
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'b.txt'), 'b\n')
    writeFileSync(join(dir, 'a.txt'), 'changed\n')
    const result = await readGitPatch(join(dir, 'sub'), { path: 'b.txt' })
    expect(result.ok && result.patch).toContain('+++ b/sub/b.txt')
    expect(result.ok && result.patch).not.toContain('a.txt')
  })

  it('names binary untracked files instead of inlining them', async () => {
    const dir = repo()
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([1, 0, 2]))
    const result = await readGitPatch(dir, {})
    expect(result.ok && result.omittedUntracked).toEqual(['blob.bin'])
  })

  it('shows one commit with its subject', async () => {
    const dir = repo()
    writeFileSync(join(dir, 'a.txt'), 'one\nthree\n')
    git(dir, 'commit', '-qam', 'second change')
    const result = await readGitPatch(dir, { commit: 'HEAD' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.commit).toEqual({ sha: git(dir, 'rev-parse', 'HEAD'), subject: 'second change' })
    expect(result.patch).toContain('-two')
    expect(result.patch).toContain('+three')
  })

  it('returns an empty patch for a clean tree', async () => {
    const result = await readGitPatch(repo(), {})
    expect(result).toEqual({ ok: true, patch: '' })
  })

  it('rejects unknown commits and option-shaped refs', async () => {
    const dir = repo()
    expect(await readGitPatch(dir, { commit: 'nope' })).toMatchObject({ ok: false, error: 'bad_commit' })
    expect(await readGitPatch(dir, { commit: '--output=/tmp/x' })).toMatchObject({ ok: false, error: 'bad_commit' })
  })

  it('reports a folder outside git', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-patch-plain-'))
    trash.push(dir)
    expect(await readGitPatch(dir, {})).toMatchObject({ ok: false, error: 'not_git' })
  })
})
