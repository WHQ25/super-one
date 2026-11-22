import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import {
  capturePrivateTreeSnapshot,
  diffPrivateTrees,
  getWorkspaceFullDiff,
  resolveGitRepoInfo,
} from './git-private-snapshot'
import { buildTurnsFromTranscript, extractTurnToolTouchedPaths } from './tool-diff-extract'

const tempDirs: string[] = []

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'superone-review-test-'))
  tempDirs.push(dir)
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  writeFileSync(
    join(dir, 'app.ts'),
    'const a = 1\nconst b = 2\nconst c = 3\nconst d = 4\nconst e = 5\nconst f = 6\nconst g = 7\nconst h = 8\nconst i = 9\nconst j = 10\nconst k = 11\nconst l = 12\n',
  )
  execFileSync('git', ['add', 'app.ts'], { cwd: dir })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir })
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('git-private-snapshot', () => {
  it('captures turn delta without touching git index and excludes pre-existing dirty edits', async () => {
    const repoDir = createTempGitRepo()
    const snapDir = mkdtempSync(join(tmpdir(), 'superone-snap-'))
    tempDirs.push(snapDir)

    writeFileSync(join(repoDir, 'preexisting.ts'), 'export const dirty = true\n')
    const statusBefore = execFileSync('git', ['status', '--porcelain=v1'], { cwd: repoDir, encoding: 'utf-8' })

    const repo = await resolveGitRepoInfo(repoDir)
    expect(repo).not.toBeNull()

    const beforeTree = await capturePrivateTreeSnapshot(repo!, snapDir)
    expect(beforeTree).toMatch(/^[0-9a-f]{40}$/)

    writeFileSync(join(repoDir, 'app.ts'), 'const a = 10\nconst b = 2\nconst c = 3\nconst d = 4\nconst e = 5\nconst f = 6\nconst g = 7\nconst h = 8\n')
    writeFileSync(join(repoDir, 'new-file.ts'), 'export const added = 1\n')

    const afterTree = await capturePrivateTreeSnapshot(repo!, snapDir)
    expect(afterTree).toMatch(/^[0-9a-f]{40}$/)

    const diffs = await diffPrivateTrees(repo!, snapDir, beforeTree!, afterTree!)
    const paths = diffs.map((d) => d.path)
    expect(paths).toEqual(['app.ts', 'new-file.ts'])
    expect(paths).not.toContain('preexisting.ts')

    const statusAfter = execFileSync('git', ['status', '--porcelain=v1'], { cwd: repoDir, encoding: 'utf-8' })
    expect(statusAfter).toContain('?? preexisting.ts')
    expect(statusAfter).toContain('?? new-file.ts')
    expect(statusAfter).not.toContain('A  new-file.ts')
    expect(statusBefore).toContain('?? preexisting.ts')
  })

  it('computes workspace full diff including untracked, staged, unstaged, and commit modes', async () => {
    const repoDir = createTempGitRepo()
    writeFileSync(
      join(repoDir, 'app.ts'),
      'const a = 100\nconst b = 2\nconst c = 3\nconst d = 4\nconst e = 5\nconst f = 6\nconst g = 7\nconst h = 8\nconst i = 9\nconst j = 10\nconst k = 11\nconst l = 1200\n',
    )
    execFileSync('git', ['add', 'app.ts'], { cwd: repoDir })
    writeFileSync(join(repoDir, 'untracked.ts'), 'export const u = 1\n')

    const ws = await getWorkspaceFullDiff(repoDir)
    expect(ws.isRepo).toBe(true)
    expect(ws.files.map((f) => f.path)).toEqual(['app.ts', 'untracked.ts'])
    expect(ws.repos?.length).toBeGreaterThanOrEqual(1)
    expect(ws.recentCommits?.length).toBeGreaterThanOrEqual(1)

    const staged = await getWorkspaceFullDiff(repoDir, { mode: 'staged' })
    expect(staged.files.map((f) => f.path)).toEqual(['app.ts'])

    const unstaged = await getWorkspaceFullDiff(repoDir, { mode: 'unstaged' })
    expect(unstaged.files.map((f) => f.path)).toEqual(['untracked.ts'])

    const firstCommitSha = ws.recentCommits![0].sha
    const committed = await getWorkspaceFullDiff(repoDir, { mode: 'commit', commitSha: firstCommitSha })
    expect(committed.files.map((f) => f.path)).toEqual(['app.ts'])
  })
})

describe('tool-diff-extract', () => {
  it('extracts touched paths and synthesizes per-turn diffs from transcript messages', () => {
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        status: 'complete',
        createdAt: '2026-11-22T00:00:00.000Z',
        providerId: 'local',
        content: [{ type: 'text', text: 'Update helper' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        status: 'complete',
        createdAt: '2026-11-22T00:00:02.000Z',
        providerId: 'claude',
        content: [
          {
            type: 'tool_use',
            toolUseId: 't1',
            toolName: 'Edit',
            input: JSON.stringify({
              file_path: '/repo/src/helper.ts',
              old_string: 'export const x = 1',
              new_string: 'export const x = 2',
            }),
          },
        ],
      },
    ]

    const touched = extractTurnToolTouchedPaths(messages, '/repo')
    expect(Array.from(touched)).toEqual(['src/helper.ts'])

    const turns = buildTurnsFromTranscript(messages, '/repo')
    expect(turns).toHaveLength(1)
    expect(turns[0].promptPreview).toBe('Update helper')
    expect(turns[0].files).toHaveLength(1)
    expect(turns[0].files[0].path).toBe('src/helper.ts')
    expect(turns[0].files[0].additions).toBe(1)
    expect(turns[0].files[0].deletions).toBe(1)
  })
})
