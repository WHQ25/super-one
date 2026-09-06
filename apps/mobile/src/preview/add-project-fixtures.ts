import type { GithubRepoHit, RemoteCommand } from '@superone/shared/agent-types'

const HOME = '/Users/preview'

/** One directory tree deep enough to browse into and to type a missing leaf against. */
const TREE: Record<string, string[]> = {
  [HOME]: ['Developer', 'Documents', 'Downloads', 'Sites'],
  [`${HOME}/Developer`]: ['Projects', 'Github', 'scratch'],
  [`${HOME}/Developer/Projects`]: ['super-one', 'design-system', 'internal-platform-observability'],
  [`${HOME}/Developer/Github`]: ['codex', 'lucide'],
}

function repo(
  owner: string,
  name: string,
  description: string | null,
  stars: number | null,
  isPrivate = false,
): GithubRepoHit {
  return { owner, name, fullName: `${owner}/${name}`, description, private: isPrivate, stars }
}

const MY_REPOS: GithubRepoHit[] = [
  repo('preview-user', 'super-one', 'Every coding agent on one surface.', 1284),
  repo('preview-user', 'dotfiles', null, 42),
  repo('preview-user', 'relay-experiments', 'Durable Object relay spikes.', null, true),
  repo('preview-user', 'design-system', 'Tokens and primitives.', 7),
]

const OWNER_REPOS: Record<string, GithubRepoHit[]> = {
  vercel: [
    repo('vercel', 'next.js', 'The React Framework.', 132_000),
    repo('vercel', 'turborepo', 'Build system for JavaScript and TypeScript.', 27_400),
    repo('vercel', 'ai', 'The AI Toolkit for TypeScript.', 15_200),
  ],
  anthropics: [
    repo('anthropics', 'claude-code', 'Agentic coding in your terminal.', 41_900),
    repo('anthropics', 'anthropic-sdk-typescript', null, 2_180),
  ],
}

const SEARCH_HITS: GithubRepoHit[] = [
  repo('facebook', 'react-native', 'A framework for building native apps with React.', 122_000),
  repo('expo', 'expo', 'An open-source framework for making universal native apps.', 39_600),
  repo('software-mansion', 'react-native-reanimated', 'React Native animations, done right.', 9_400),
]

/**
 * Offline stand-in for the paired desktop. Covers every command the add-project
 * flow issues, so each of its four steps is reachable in the preview shell.
 */
export async function previewAddProjectRequest(command: RemoteCommand): Promise<unknown> {
  if (command.type === 'browse_host_directory') {
    const path = command.path.replace(/^~/, HOME).replace(/\/+$/, '') || HOME
    const names = TREE[path]
    if (!names) return { error: `path not found: ${path}` }
    return { path, entries: names.map((name) => ({ name, path: `${path}/${name}` })) }
  }
  if (command.type === 'search_github_repos') {
    if (command.mode === 'mine') return { repos: MY_REPOS, hasMore: false }
    if (command.mode === 'owner') {
      return { repos: OWNER_REPOS[(command.value ?? '').toLowerCase()] ?? [] }
    }
    return { repos: SEARCH_HITS }
  }
  if (command.type === 'add_project') return { success: true }
  if (command.type === 'clone_repository') {
    const name = command.directoryName ?? 'cloned-repo'
    return { path: `${command.parentPath.replace(/\/+$/, '')}/${name}`, name }
  }
  return { error: `preview has no fixture for ${command.type}` }
}
