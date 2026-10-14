import type { Meta, StoryObj } from '@storybook/react-vite'
import type { GitPatchResult } from '@superone/shared/agent-types'
import { DiffPanel, type GitPatchLoader } from './DiffPanel'

/** The read-only change-set tab an agent opens with `ui_act` → `open_diff`. */

const EDIT = `diff --git a/apps/desktop/src/main/git-run.ts b/apps/desktop/src/main/git-run.ts
index 3f1c2a1..9b0d4e2 100644
--- a/apps/desktop/src/main/git-run.ts
+++ b/apps/desktop/src/main/git-run.ts
@@ -1,9 +1,10 @@
 /** Git / gh process helpers from \`@superone/runtime/git\`, run on the login-shell PATH. */
 import { ghRun as runGh, gitRun as runGit } from '@superone/runtime/git'
 import { withShellPath } from './shell-path'

-export { isNotGitRepoError, type GitRunOptions } from '@superone/runtime/git'
+export { isNotGitRepoError, gitErrorMessage, type GitRunOptions } from '@superone/runtime/git'

 export const gitRun = withShellPath(runGit)
 /** \`gh\` is usually Homebrew-only, so it is missing from launchd's PATH. */
 export const ghRun = withShellPath(runGh)
+export const GIT_READ_TIMEOUT_MS = 20_000
`

const NEW_FILE = `diff --git a/apps/desktop/src/main/git-patch.ts b/apps/desktop/src/main/git-patch.ts
new file mode 100644
--- /dev/null
+++ b/apps/desktop/src/main/git-patch.ts
@@ -0,0 +1,6 @@
+import { readFile, realpath, stat } from 'node:fs/promises'
+import { join, relative, resolve } from 'node:path'
+import type { GitPatchRequest, GitPatchResult } from '@superone/shared/agent-types'
+import { gitRun, isNotGitRepoError } from './git-run'
+
+const UNTRACKED_BODY_LIMIT = 200
`

const DELETED = `diff --git a/docs/plans/ui-control.md b/docs/plans/ui-control.md
deleted file mode 100644
--- a/docs/plans/ui-control.md
+++ /dev/null
@@ -1,3 +0,0 @@
-# UI control plan
-
-Superseded by docs/features/ui-control.md.
`

const RENAMED = `diff --git a/assets/old-logo.png b/assets/logo.png
similarity index 100%
rename from assets/old-logo.png
rename to assets/logo.png
`

const BINARY = `diff --git a/assets/icon.icns b/assets/icon.icns
index 1a2b3c4..5d6e7f8 100644
Binary files a/assets/icon.icns and b/assets/icon.icns differ
`

function longFile(index: number): string {
  const body = Array.from({ length: 60 }, (_, line) => `+export const generated${index}_${line} = ${line} // a deliberately long line so the diff body must scroll horizontally inside the panel`).join('\n')
  return `diff --git a/src/generated/file-${index}.ts b/src/generated/file-${index}.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/generated/file-${index}.ts\n@@ -0,0 +1,60 @@\n${body}\n`
}

function loader(result: GitPatchResult, delayMs = 0): GitPatchLoader {
  return () => new Promise((resolve) => setTimeout(() => resolve(result), delayMs))
}

const meta: Meta<typeof DiffPanel> = {
  title: 'Activity/Diff Panel',
  component: DiffPanel,
  args: { root: '/Users/me/project' },
  decorators: [
    (Story) => (
      <div className="h-[640px] w-[720px] overflow-hidden rounded-md border border-border bg-card">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof DiffPanel>

export const Uncommitted: Story = {
  args: { load: loader({ ok: true, patch: EDIT + NEW_FILE + DELETED, omittedUntracked: ['assets/demo.mp4'] }) },
}

export const Commit: Story = {
  args: {
    commit: '553f7bf6b',
    load: loader({ ok: true, patch: EDIT + RENAMED + BINARY, commit: { sha: '553f7bf6b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5', subject: 'fix(usage): stop the refresh tooltip from opening with the gauge' } }),
  },
}

export const SingleFile: Story = {
  args: { path: 'apps/desktop/src/main/git-run.ts', load: loader({ ok: true, patch: EDIT }) },
}

export const Empty: Story = {
  args: { load: loader({ ok: true, patch: '' }) },
}

export const EmptyCommit: Story = {
  args: { commit: 'a1b2c3d', load: loader({ ok: true, patch: '', commit: { sha: 'a1b2c3d4e5f6', subject: 'chore: merge branch main' } }) },
}

export const Loading: Story = {
  args: { load: () => new Promise(() => {}) },
}

export const RemoteProject: Story = {
  args: { root: 'remote:node-1:/srv/app', load: loader({ ok: false, error: 'remote_project' }) },
}

export const BadCommit: Story = {
  args: { commit: 'deadbeef', load: loader({ ok: false, error: 'bad_commit', message: 'Not a commit: deadbeef' }) },
}

export const ReadFailed: Story = {
  args: { load: loader({ ok: false, error: 'failed', message: 'git diff --no-color HEAD timed out after 20000ms in /Users/me/project' }) },
}

/** Past eight files every section starts folded, so the list reads as an overview. */
export const VeryLongDiff: Story = {
  args: { load: loader({ ok: true, patch: Array.from({ length: 24 }, (_, i) => longFile(i)).join('') }) },
}

export const LongSingleFile: Story = {
  args: { path: 'src/generated/file-0.ts', load: loader({ ok: true, patch: longFile(0) }) },
}

export const Narrow: Story = {
  args: { commit: '553f7bf6b', load: loader({ ok: true, patch: EDIT + NEW_FILE, commit: { sha: '553f7bf6b0c1d2e3', subject: 'fix(usage): stop the refresh tooltip from opening with the gauge' } }) },
  decorators: [(Story) => <div className="h-[640px] w-[320px] overflow-hidden"><Story /></div>],
}

export const Dark: Story = {
  ...Uncommitted,
  globals: { theme: 'dark' },
}

export const Chinese: Story = {
  ...Commit,
  globals: { locale: 'zh' },
}
