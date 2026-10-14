import { readFile, realpath, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { GitPatchRequest, GitPatchResult } from '@superone/shared/agent-types'
import { gitRun, isNotGitRepoError } from './git-run'

/** Untracked files beyond this are listed by name only — a stray build dir must not stall the panel. */
const UNTRACKED_BODY_LIMIT = 200
/** Larger untracked files are listed by name only; a diff panel is not a file viewer. */
const UNTRACKED_MAX_BYTES = 256 * 1024
const GIT_TIMEOUT_MS = 20_000

/**
 * `git diff` leaves untracked files out, but they are most of what an agent
 * adds. Render one as the patch git would print after `git add -N`, without
 * touching the index.
 */
export function untrackedFilePatch(path: string, content: string): string {
  const header = `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n`
  if (!content) return header
  const lines = content.split('\n')
  const endsWithNewline = content.endsWith('\n')
  if (endsWithNewline) lines.pop()
  const body = lines.map((line) => `+${line}`).join('\n')
  return `${header}@@ -0,0 +1,${lines.length} @@\n${body}\n${endsWithNewline ? '' : '\\ No newline at end of file\n'}`
}

function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0)
}

function git(cwd: string, args: string[]): Promise<string> {
  return gitRun(cwd, args, undefined, { timeoutMs: GIT_TIMEOUT_MS })
}

async function untrackedPatches(top: string, path: string | undefined): Promise<{ patch: string; omitted: string[] }> {
  const raw = await git(top, ['ls-files', '--others', '--exclude-standard', '-z', ...(path ? ['--', path] : [])])
  const files = raw.split('\0').filter(Boolean)
  const patches: string[] = []
  const omitted: string[] = []
  for (const [index, file] of files.entries()) {
    if (index >= UNTRACKED_BODY_LIMIT) {
      omitted.push(file)
      continue
    }
    const absolute = join(top, file)
    const info = await stat(absolute).catch(() => null)
    if (!info?.isFile() || info.size > UNTRACKED_MAX_BYTES) {
      omitted.push(file)
      continue
    }
    const buffer = await readFile(absolute)
    if (isBinary(buffer)) {
      omitted.push(file)
      continue
    }
    patches.push(untrackedFilePatch(file, buffer.toString('utf8')))
  }
  return { patch: patches.join(''), omitted }
}

/**
 * The patch the read-only diff panel renders: working tree against HEAD
 * (tracked + untracked) or one commit against its first parent.
 */
export async function readGitPatch(root: string, request: GitPatchRequest): Promise<GitPatchResult> {
  const commit = request.commit?.trim()
  // A leading dash would turn the ref into a git option.
  if (commit !== undefined && (!commit || commit.startsWith('-'))) return { ok: false, error: 'bad_commit', message: `Not a commit: ${request.commit}` }
  try {
    const top = await git(root, ['rev-parse', '--show-toplevel'])
    // Relative paths are the caller's, so they resolve against its folder, not the repository root.
    // git prints the real path, so a symlinked folder (macOS /var → /private/var) must be resolved first.
    const path = request.path ? relative(top, resolve(await realpath(root), request.path)) : undefined
    const scope = path ? ['--', path] : []
    if (commit) {
      const sha = await git(top, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`]).catch(() => '')
      if (!sha) return { ok: false, error: 'bad_commit', message: `Not a commit: ${commit}` }
      const subject = await git(top, ['log', '-1', '--format=%s', sha])
      const patch = await git(top, ['show', '--no-color', '--format=', '--diff-merges=first-parent', sha, ...scope])
      return { ok: true, patch: patch ? `${patch}\n` : '', commit: { sha, subject } }
    }
    // A repository without commits has no HEAD to diff against; its files are all untracked.
    const hasHead = await git(top, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(Boolean, () => false)
    const tracked = hasHead ? await git(top, ['diff', '--no-color', 'HEAD', ...scope]) : ''
    const untracked = await untrackedPatches(top, path)
    return {
      ok: true,
      patch: `${tracked ? `${tracked}\n` : ''}${untracked.patch}`,
      ...(untracked.omitted.length ? { omittedUntracked: untracked.omitted } : {}),
    }
  } catch (err) {
    if (isNotGitRepoError(err)) return { ok: false, error: 'not_git' }
    return { ok: false, error: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
}
