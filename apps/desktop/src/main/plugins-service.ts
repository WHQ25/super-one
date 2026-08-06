/**
 * Claude plugins service — re-export runtime logic + desktop-only GitHub helpers.
 */
export {
  listPlugins,
  readPluginContent,
  readPluginFile,
  deletePlugin,
  listMarketplacePlugins,
  installPlugin,
  updatePlugin,
  updateMarketplace,
  addMarketplace,
  removeMarketplace,
  readMarketplacePluginContent,
  readMarketplacePluginFile,
} from '@superone/runtime/fs'

import { execFile } from 'child_process'

export interface GithubRepoSearchHit {
  owner: string
  name: string
  fullName: string
  description: string | null
  private: boolean
}

type GithubRepoJson = {
  name?: string
  full_name?: string
  description?: string | null
  private?: boolean
  owner?: { login?: string }
}

function mapGithubRepoHits(rows: GithubRepoJson[]): GithubRepoSearchHit[] {
  const hits: GithubRepoSearchHit[] = []
  for (const row of rows) {
    const fullName = typeof row.full_name === 'string' ? row.full_name : ''
    const [ownerFromFull, nameFromFull] = fullName.split('/')
    const owner = row.owner?.login || ownerFromFull
    const name = typeof row.name === 'string' ? row.name : nameFromFull
    if (!owner || !name) continue
    hits.push({
      owner,
      name,
      fullName: fullName || `${owner}/${name}`,
      description: typeof row.description === 'string' ? row.description : null,
      private: Boolean(row.private),
    })
  }
  return hits
}

/** Fetch a GitHub repo's star count. Prefers `gh` CLI; falls back to REST API. */
export async function getGithubStars(repoSlug: string): Promise<number | null> {
  const slug = repoSlug.split('/').slice(0, 2).join('/')
  if (slug.split('/').length !== 2 || !slug.split('/').every(Boolean)) return null

  const viaGh = await new Promise<number | null>((resolve) => {
    execFile(
      'gh',
      ['api', `repos/${slug}`, '--jq', '.stargazers_count'],
      { timeout: 10000 },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        const n = Number(stdout.trim())
        resolve(Number.isFinite(n) ? n : null)
      },
    )
  })
  if (viaGh != null) return viaGh

  try {
    const res = await fetch(`https://api.github.com/repos/${slug}`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { stargazers_count?: number }
    return typeof data.stargazers_count === 'number' ? data.stargazers_count : null
  } catch {
    return null
  }
}

/**
 * List repositories under a GitHub user/org for the add-project picker.
 * Prefers `gh`; falls back to public REST API.
 */
export async function listGithubReposForOwner(owner: string): Promise<GithubRepoSearchHit[]> {
  const login = owner.trim()
  if (!login || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(login)) return []

  const viaGh = await new Promise<GithubRepoSearchHit[] | null>((resolve) => {
    execFile(
      'gh',
      [
        'api',
        `users/${encodeURIComponent(login)}/repos?per_page=50&sort=updated&type=all`,
        '--jq',
        '[.[] | {name, full_name, description, private, owner: {login: .owner.login}}]',
      ],
      { timeout: 15000 },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        try {
          const parsed = JSON.parse(stdout) as GithubRepoJson[]
          resolve(Array.isArray(parsed) ? mapGithubRepoHits(parsed) : null)
        } catch {
          resolve(null)
        }
      },
    )
  })
  if (viaGh) return viaGh

  try {
    const res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=50&sort=updated&type=all`,
      {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15000),
      },
    )
    if (!res.ok) return []
    const data = (await res.json()) as GithubRepoJson[]
    return Array.isArray(data) ? mapGithubRepoHits(data) : []
  } catch {
    return []
  }
}

export type MyGithubReposPage = {
  repos: GithubRepoSearchHit[]
  hasMore: boolean
  /** True when `gh` is missing or not authenticated — caller should show a hint. */
  unavailable: boolean
}

/**
 * Authenticated user's repos for the add-project GitHub default view.
 * Requires `gh` CLI (uses its credentials). Sorted by recent activity.
 */
export async function listMyGithubRepos(
  page = 1,
  perPage = 20,
): Promise<MyGithubReposPage> {
  const pageNum = Math.max(1, Math.floor(page))
  const limit = Math.min(50, Math.max(1, Math.floor(perPage)))

  const viaGh = await new Promise<MyGithubReposPage | null>((resolve) => {
    execFile(
      'gh',
      [
        'api',
        // Authenticated viewer; sort=updated matches "recent activity".
        `user/repos?per_page=${limit}&page=${pageNum}&sort=updated&direction=desc`,
        '--jq',
        '[.[] | {name, full_name, description, private, owner: {login: .owner.login}}]',
      ],
      { timeout: 20000 },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        try {
          const parsed = JSON.parse(stdout) as GithubRepoJson[]
          if (!Array.isArray(parsed)) {
            resolve(null)
            return
          }
          const repos = mapGithubRepoHits(parsed)
          resolve({
            repos,
            hasMore: repos.length >= limit,
            unavailable: false,
          })
        } catch {
          resolve(null)
        }
      },
    )
  })

  if (viaGh) return viaGh
  return { repos: [], hasMore: false, unavailable: true }
}
