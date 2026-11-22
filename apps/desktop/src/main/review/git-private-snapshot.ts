import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  ReviewCommitInfo,
  ReviewFileContentsPair,
  ReviewFileDiff,
  ReviewRepoInfo,
  ReviewWorkspaceData,
  ReviewWorkspaceFilter,
} from '@superone/shared/review-types'
import { ensureShellPath } from '../shell-path'
import {
  countPatchLines,
  normalizePosixPath,
  splitUnifiedDiffByFile,
  sumFileDiffTotals,
  synthesizeAddedFilePatch,
} from './patch-utils'

const GIT_MAX_BUFFER = 24 * 1024 * 1024
const MAX_UNTRACKED_TEXT_BYTES = 512 * 1024

export interface GitRepoInfo {
  repoRoot: string
  objectsDir: string
}

async function execGit(
  cwd: string,
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  await ensureShellPath()
  return new Promise((res) => {
    execFile(
      'git',
      args,
      {
        cwd,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...extraEnv },
        maxBuffer: GIT_MAX_BUFFER,
      },
      (err, stdout, stderr) => {
        if (err) {
          res({ stdout: stdout ?? '', stderr: stderr ?? err.message, ok: false })
          return
        }
        res({ stdout: stdout ?? '', stderr: stderr ?? '', ok: true })
      },
    )
  })
}

export async function canonicalDirectory(dir: string): Promise<string> {
  try {
    return await realpath(dir)
  } catch {
    return resolve(dir)
  }
}

export async function resolveGitRepoInfo(cwd: string): Promise<GitRepoInfo | null> {
  const top = await execGit(cwd, ['rev-parse', '--show-toplevel'])
  if (!top.ok || !top.stdout.trim()) return null
  const repoRoot = await canonicalDirectory(top.stdout.trim())
  const common = await execGit(repoRoot, ['rev-parse', '--git-common-dir'])
  if (!common.ok || !common.stdout.trim()) return null
  const rawCommon = common.stdout.trim()
  const commonDir = isAbsolute(rawCommon) ? rawCommon : resolve(repoRoot, rawCommon)
  return {
    repoRoot,
    objectsDir: join(commonDir, 'objects'),
  }
}

export async function capturePrivateTreeSnapshot(
  repo: GitRepoInfo,
  snapshotDir: string,
): Promise<string | null> {
  const privateObjects = join(snapshotDir, 'objects')
  await mkdir(privateObjects, { recursive: true })
  const tempIndex = join(snapshotDir, `idx-${randomUUID()}`)
  const env = {
    GIT_INDEX_FILE: tempIndex,
    GIT_OBJECT_DIRECTORY: privateObjects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: repo.objectsDir,
  }
  try {
    const addResult = await execGit(repo.repoRoot, ['add', '-A', '--', '.'], env)
    if (!addResult.ok) return null
    const treeResult = await execGit(repo.repoRoot, ['write-tree'], env)
    if (!treeResult.ok) return null
    const sha = treeResult.stdout.trim()
    return /^[0-9a-f]{40}$/i.test(sha) ? sha : null
  } finally {
    await rm(tempIndex, { force: true }).catch(() => {})
  }
}

export async function diffPrivateTrees(
  repo: GitRepoInfo,
  snapshotDir: string,
  beforeTree: string,
  afterTree: string,
): Promise<ReviewFileDiff[]> {
  if (beforeTree === afterTree) return []
  const privateObjects = join(snapshotDir, 'objects')
  const env = {
    GIT_OBJECT_DIRECTORY: privateObjects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: repo.objectsDir,
  }
  const diffRes = await execGit(
    repo.repoRoot,
    ['diff', '-M', '-U3', '--no-color', beforeTree, afterTree],
    env,
  )
  if (!diffRes.ok) return []
  return splitUnifiedDiffByFile(diffRes.stdout, 'git-snapshot')
}

function isBinaryBuffer(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000)
  for (let i = 0; i < len; i += 1) {
    if (buf[i] === 0) return true
  }
  return false
}

interface PorcelainFlags {
  staged: boolean
  unstaged: boolean
  untracked: boolean
  path: string
}

function parsePorcelainFlags(raw: string): Map<string, PorcelainFlags> {
  const map = new Map<string, PorcelainFlags>()
  for (const line of raw.split('\n')) {
    if (line.length < 4) continue
    const x = line[0]
    const y = line[1]
    const rest = line.slice(3)
    const arrow = rest.indexOf(' -> ')
    const rawPath = arrow >= 0 ? rest.slice(arrow + 4) : rest
    const cleanPath = normalizePosixPath(
      rawPath.startsWith('"') && rawPath.endsWith('"') ? rawPath.slice(1, -1) : rawPath,
    )
    if (!cleanPath) continue
    const untracked = x === '?' && y === '?'
    map.set(cleanPath, {
      staged: !untracked && x !== ' ',
      unstaged: !untracked && y !== ' ',
      untracked,
      path: cleanPath,
    })
  }
  return map
}

const IGNORED_SCAN_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'target',
  '.turbo',
  '.cache',
  'out',
])

async function getBranchName(repoRoot: string): Promise<string | null> {
  const res = await execGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!res.ok) return null
  const name = res.stdout.trim()
  return name && name !== 'HEAD' ? name : null
}

async function detectBaseBranch(repoRoot: string): Promise<string | null> {
  const sym = await execGit(repoRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
  if (sym.ok && sym.stdout.trim()) {
    const ref = sym.stdout.trim().replace(/^refs\/remotes\/origin\//, '')
    if (ref) return ref
  }
  for (const candidate of ['main', 'master']) {
    const check = await execGit(repoRoot, ['rev-parse', '--verify', candidate])
    if (check.ok) return candidate
  }
  return null
}

async function getRecentCommits(repoRoot: string): Promise<ReviewCommitInfo[]> {
  const res = await execGit(repoRoot, ['log', '-n', '15', '--format=%H%x09%h%x09%s%x09%cr'])
  if (!res.ok || !res.stdout.trim()) return []
  const commits: ReviewCommitInfo[] = []
  for (const line of res.stdout.split('\n')) {
    if (!line.trim()) continue
    const [sha, shortSha, subject, relativeTime] = line.split('\t')
    if (sha && shortSha) {
      commits.push({ sha, shortSha, subject: subject ?? '', relativeTime: relativeTime ?? '' })
    }
  }
  return commits
}

async function discoverWorkspaceRepos(
  folderPath: string,
  mainRepo: GitRepoInfo | null,
): Promise<ReviewRepoInfo[]> {
  const repos: ReviewRepoInfo[] = []
  const seenRoots = new Set<string>()
  const canonicalFolder = await canonicalDirectory(folderPath)

  if (mainRepo) {
    seenRoots.add(mainRepo.repoRoot)
    repos.push({
      path: mainRepo.repoRoot,
      name: basename(mainRepo.repoRoot) || mainRepo.repoRoot,
      branch: await getBranchName(mainRepo.repoRoot),
      isMain: true,
    })
  }

  const scan = async (dir: string, depth: number) => {
    if (depth > 2) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_SCAN_DIRS.has(entry.name) || entry.name.startsWith('.')) {
        continue
      }
      const subDir = join(dir, entry.name)
      try {
        await stat(join(subDir, '.git'))
        const subRepo = await resolveGitRepoInfo(subDir)
        if (subRepo && !seenRoots.has(subRepo.repoRoot)) {
          seenRoots.add(subRepo.repoRoot)
          repos.push({
            path: subRepo.repoRoot,
            name: relative(canonicalFolder, subRepo.repoRoot) || basename(subRepo.repoRoot),
            branch: await getBranchName(subRepo.repoRoot),
            isMain: false,
          })
        }
      } catch {
        if (depth < 2) await scan(subDir, depth + 1)
      }
    }
  }

  await scan(canonicalFolder, 1)
  return repos
}

export async function getWorkspaceFullDiff(
  folderPath: string,
  filter?: ReviewWorkspaceFilter,
): Promise<ReviewWorkspaceData> {
  const repo = await resolveGitRepoInfo(folderPath)
  const repos = await discoverWorkspaceRepos(folderPath, repo)
  if (!repo) {
    return {
      root: folderPath,
      isRepo: false,
      files: [],
      totalAdditions: 0,
      totalDeletions: 0,
      repos,
    }
  }

  const mode = filter?.mode ?? 'uncommitted'
  const [currentBranch, baseBranch, recentCommits] = await Promise.all([
    getBranchName(repo.repoRoot),
    detectBaseBranch(repo.repoRoot),
    getRecentCommits(repo.repoRoot),
  ])

  const statusRes = await execGit(repo.repoRoot, ['status', '--porcelain=v1', '-uall'])
  const flagsByPath = parsePorcelainFlags(statusRes.ok ? statusRes.stdout : '')
  const hasHead = (await execGit(repo.repoRoot, ['rev-parse', '--verify', 'HEAD'])).ok

  let diffRes: { stdout: string; stderr: string; ok: boolean }
  let includeUntracked = false

  if (mode === 'staged') {
    diffRes = await execGit(repo.repoRoot, ['diff', '--cached', '-M', '-U3', '--no-color'])
  } else if (mode === 'unstaged') {
    diffRes = await execGit(repo.repoRoot, ['diff', '-M', '-U3', '--no-color'])
    includeUntracked = true
  } else if (mode === 'commit' && filter?.commitSha && /^[0-9a-f]{4,40}$/i.test(filter.commitSha)) {
    diffRes = await execGit(repo.repoRoot, ['show', '--format=', '-M', '-U3', '--no-color', filter.commitSha])
  } else if (mode === 'branch' && baseBranch) {
    diffRes = await execGit(repo.repoRoot, ['diff', `${baseBranch}...HEAD`, '-M', '-U3', '--no-color'])
  } else {
    const diffArgs = hasHead
      ? ['diff', 'HEAD', '-M', '-U3', '--no-color']
      : ['diff', '--cached', '-M', '-U3', '--no-color']
    diffRes = await execGit(repo.repoRoot, diffArgs)
    includeUntracked = true
  }

  const trackedFiles = diffRes.ok ? splitUnifiedDiffByFile(diffRes.stdout, 'workspace-git') : []

  const seen = new Set<string>()
  const files: ReviewFileDiff[] = []

  for (const file of trackedFiles) {
    seen.add(file.path)
    const flags = flagsByPath.get(file.path)
    files.push({
      ...file,
      staged: mode === 'commit' || mode === 'branch' ? false : (flags?.staged ?? false),
      unstaged: mode === 'commit' || mode === 'branch' ? false : (flags?.unstaged ?? false),
      untracked: false,
    })
  }

  if (includeUntracked) {
    for (const [filePath, flags] of flagsByPath) {
      if (!flags.untracked || seen.has(filePath)) continue
      const fullPath = resolve(repo.repoRoot, filePath)
      try {
        const info = await stat(fullPath)
        if (!info.isFile()) continue
        if (info.size > MAX_UNTRACKED_TEXT_BYTES) {
          files.push({
            path: filePath,
            status: 'added',
            additions: 0,
            deletions: 0,
            patch: '',
            isBinary: true,
            untracked: true,
            source: 'workspace-git',
          })
          continue
        }
        const buf = await readFile(fullPath)
        if (isBinaryBuffer(buf)) {
          files.push({
            path: filePath,
            status: 'added',
            additions: 0,
            deletions: 0,
            patch: '',
            isBinary: true,
            untracked: true,
            source: 'workspace-git',
          })
          continue
        }
        const text = buf.toString('utf-8')
        const patch = synthesizeAddedFilePatch(filePath, text)
        const { additions, deletions } = countPatchLines(patch)
        files.push({
          path: filePath,
          status: 'added',
          additions,
          deletions,
          patch,
          untracked: true,
          source: 'workspace-git',
        })
      } catch {
        continue
      }
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path))
  const totals = sumFileDiffTotals(files)
  return {
    root: repo.repoRoot,
    isRepo: true,
    files,
    totalAdditions: totals.additions,
    totalDeletions: totals.deletions,
    currentBranch,
    baseBranch,
    repos,
    recentCommits,
  }
}

function resolveSafePath(rootDir: string, relPath: string): string | null {
  const absRoot = resolve(rootDir)
  const target = resolve(absRoot, relPath)
  const rel = relative(absRoot, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.includes(`..${sep}`)) {
    return null
  }
  return target
}

export async function getLocalFileContentsPair(
  folderPath: string,
  filePath: string,
): Promise<ReviewFileContentsPair> {
  const repo = await resolveGitRepoInfo(folderPath)
  const baseRoot = repo?.repoRoot ?? folderPath
  const safePath = resolveSafePath(baseRoot, filePath)
  if (!safePath) return { oldContent: null, newContent: null, matchesDisk: false }

  let newContent: string | null = null
  try {
    const info = await stat(safePath)
    if (info.isFile() && info.size <= MAX_UNTRACKED_TEXT_BYTES * 4) {
      const buf = await readFile(safePath)
      if (!isBinaryBuffer(buf)) newContent = buf.toString('utf-8')
    }
  } catch {
    newContent = null
  }

  let oldContent: string | null = null
  if (repo) {
    const normalized = normalizePosixPath(filePath)
    const showRes = await execGit(repo.repoRoot, ['show', `HEAD:${normalized}`])
    if (showRes.ok) oldContent = showRes.stdout
  }

  return { oldContent, newContent, matchesDisk: newContent !== null }
}
