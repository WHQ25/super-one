/**
 * `@git` / `@gh` mention rows for any project key the renderer holds — a local
 * folder (or worktree) runs git / gh here; a remote node key asks the node over
 * RPC. Both the IPC handler and the phone's `list_git_mention_refs` command go
 * through this so the two surfaces cannot drift.
 */
import {
  ghRun,
  gitRun,
  listGitMentionRefs,
  probeGitMentionCapabilities,
  type GitMentionRunners,
  type GitRunOptions,
} from '@superone/runtime/git'
import {
  GIT_MENTION_CAPABILITIES_UNKNOWN,
  type GitMentionCapabilities,
  type GitMentionRefKind,
  type GitMentionRefsResult,
} from '@superone/shared/git-mention-query'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'

const GIT_READ_OPTS: GitRunOptions = { timeoutMs: 20_000 }
/** GitHub round-trips; long enough for a slow API, short enough that a popup never hangs. */
const GH_TIMEOUT_MS = 15_000

function localRunners(folderPath: string): GitMentionRunners {
  return {
    git: (args) => gitRun(folderPath, args, undefined, GIT_READ_OPTS),
    gh: (args) => ghRun(folderPath, args, GH_TIMEOUT_MS),
  }
}

export async function resolveGitMentionRefs(
  folderPath: string,
  kind: GitMentionRefKind,
  query: string,
): Promise<GitMentionRefsResult> {
  if (parseRemoteProjectKey(folderPath)) {
    const { getEnvironmentHost } = await import('../environment')
    const { getRemoteGitMentionRefs } = await import('../environment/remote-file-tree')
    return getRemoteGitMentionRefs(getEnvironmentHost(), folderPath, kind, query)
  }
  return listGitMentionRefs(kind, query, localRunners(folderPath))
}

/**
 * The `gh` half of a capability probe is a network round-trip (`gh repo view`)
 * that the popup would otherwise repeat on every open. Whether gh is installed,
 * signed in and the remote points at GitHub does not change while the app
 * runs, so the answer is kept per folder for the process lifetime. The repo
 * half stays live: `git init` from the status bar must flip `@git` on at once.
 */
const githubProbeByFolder = new Map<string, Promise<boolean>>()

/**
 * What the `@git` / `@gh` portals may offer for a cwd — probed up front so a
 * portal is disabled in the popup instead of failing after the user typed into
 * it. Remote keys ask the node; a node that cannot answer reports `unsupported`.
 */
export async function resolveGitMentionCapabilities(folderPath: string): Promise<GitMentionCapabilities> {
  if (parseRemoteProjectKey(folderPath)) {
    const { getEnvironmentHost } = await import('../environment')
    const { getRemoteGitMentionCapabilities } = await import('../environment/remote-file-tree')
    return getRemoteGitMentionCapabilities(getEnvironmentHost(), folderPath)
  }
  try {
    const runners = localRunners(folderPath)
    const { repo } = await probeGitMentionCapabilities({ git: runners.git })
    if (repo !== 'ready') return { repo, github: false }
    let github = githubProbeByFolder.get(folderPath)
    if (!github) {
      github = probeGitMentionCapabilities(runners).then((caps) => caps.github)
      githubProbeByFolder.set(folderPath, github)
      // A probe that threw (not a gh "no") must not be remembered as "no".
      github.catch(() => githubProbeByFolder.delete(folderPath))
    }
    return { repo, github: await github }
  } catch {
    return GIT_MENTION_CAPABILITIES_UNKNOWN
  }
}
