/** Git / gh process helpers from `@superone/runtime/git`, run on the login-shell PATH. */
import { ghRun as runGh, gitRun as runGit } from '@superone/runtime/git'
import { withShellPath } from './shell-path'

export { isNotGitRepoError, type GitRunOptions } from '@superone/runtime/git'

export const gitRun = withShellPath(runGit)
/** `gh` is usually Homebrew-only, so it is missing from launchd's PATH. */
export const ghRun = withShellPath(runGh)
