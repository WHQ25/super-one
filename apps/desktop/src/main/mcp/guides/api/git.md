# superone.git — Git Integration API

Read-only access to the project's Git repository. All operations are scoped to the mini-app's working directory.

## Repository Info

```js
const info = await superone.git.info()
// → { branch: 'main', dirty?: { files: 3, insertions: 42, deletions: 7 } }
```

## Branches

```js
const branches = await superone.git.branches()
// → ['main', 'feature/auth', 'fix/typo']
```

## Commit Log

```js
const log = await superone.git.log({ limit: 20 })
// → [{ sha, parents: ['abc123'], message, author, date }, ...]

const allBranches = await superone.git.log({ limit: 100, all: true })
const branchLog = await superone.git.log({ ref: 'feature/auth' })
```

## File Status

```js
const files = await superone.git.status()
// → [{ path: 'src/main.ts', status: 'M', staged: false }, ...]
```

Status codes: `M` Modified, `A` Added, `D` Deleted, `R` Renamed, `C` Copied, `U` Unmerged, `?` Untracked, `!` Ignored.

## Diff

```js
const diff = await superone.git.diff('src/main.ts')
// → { path: 'src/main.ts', diff: '--- a/src/main.ts\n+++ b/...' }

const stagedDiff = await superone.git.diff('src/main.ts', true)  // staged changes
```

## Show File at Ref

```js
const file = await superone.git.show('HEAD~1', 'package.json')
// → { ref: 'HEAD~1', path: 'package.json', content: '...' }
```

## Blame

```js
const lines = await superone.git.blame('src/main.ts')
// → [{ sha, author, date, lineNo, content }, ...]
```

Each entry represents one line of the file with its last-modifying commit.

## Diff Summary (Between Refs)

```js
const files = await superone.git.diffSummary('main', 'feature/auth')
// → [{ path: 'src/auth.ts', insertions: 42, deletions: 7 }, ...]

const vsHead = await superone.git.diffSummary('HEAD~5')
// → changed files in the last 5 commits
```

## Commit Detail

```js
const commit = await superone.git.getCommit('abc1234')
// → { sha, parents, subject, body, author, email, date, files: [{ path, insertions, deletions }] }

const head = await superone.git.getCommit() // defaults to HEAD
```

## Tags

```js
const tags = await superone.git.tags()
// → [{ name: 'v1.0.0', sha: 'abc1234', date: '2025-01-01 ...' }, ...]
```

Sorted by creation date (newest first).

## Remotes

```js
const remotes = await superone.git.remotes()
// → [{ name: 'origin', fetchUrl: 'https://...', pushUrl: 'https://...' }]
```

## Branch Detail

```js
const detail = await superone.git.branchDetail('main')
// → { name: 'main', upstream: 'origin/main', ahead: 0, behind: 2 }
```

## Stash List

```js
const stashes = await superone.git.stashList()
// → [{ ref: 'stash@{0}', message: 'WIP on main: abc1234 fix typo', date: '2025-...' }]
```

## File History

```js
const history = await superone.git.logFile('src/main.ts', { limit: 20 })
// → [{ sha, parents, message, author, date }, ...]
```

Follows renames automatically (`--follow`).

## Watching for Changes

Subscribe to HEAD changes (branch switch, commit, rebase, etc.):

```js
const unsub = superone.git.onHeadChange(() => {
  // Re-fetch git data
})
// unsub() to stop
```

## Write Operations

Git writes (commit, push, merge) are not exposed directly. Use `superone.agent.sendPrompt()` to request the AI agent to perform them.
