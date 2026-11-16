import { ghRun } from '../git-run'
import { getEnvironmentHost } from '../environment'
import { landOnRemote, remoteBranchRelations, remoteBranchTips, remoteBundleHaves, withRemoteBranchBundle } from '../environment/remote-worktree'
import type { CheckoutSourceDeps } from './checkout-sources'
import { resolveGitMentionCapabilities } from './mention-refs'
import { localWorktreeGit } from './worktree-ops'

/** GitHub round-trips; a popover never waits longer than this. */
const GH_TIMEOUT_MS = 15_000

/** The window's checkout sources: login-shell git and gh, nodes through the environment host. */
export function desktopCheckoutSourceDeps(): CheckoutSourceDeps {
  const host = getEnvironmentHost()
  return {
    git: localWorktreeGit,
    gh: (cwd, args) => ghRun(cwd, args, GH_TIMEOUT_MS),
    github: async (folderPath) => (await resolveGitMentionCapabilities(folderPath)).github,
    node: {
      branchTips: (folderPath) => remoteBranchTips(host, folderPath),
      withBundle: (input, use, control) => withRemoteBranchBundle(host, input, use, control),
      haves: (folderPath) => remoteBundleHaves(host, folderPath),
      relations: (folderPath, items) => remoteBranchRelations(host, folderPath, items),
      land: (folderPath, incoming, control) => landOnRemote(host, folderPath, incoming, control),
    },
  }
}
