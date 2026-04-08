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
