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
  stars: number | null
}

type GithubRepoJson = {
  name?: string
  full_name?: string
  fullName?: string
  description?: string | null
  private?: boolean
  isPrivate?: boolean
  stargazers_count?: number
  stargazersCount?: number
  owner?: { login?: string } | string
}

const GITHUB_REPO_LIST_JQ =
  '[.[] | {name, full_name, description, private, stargazers_count, owner: {login: .owner.login}}]'

function parseStarCount(row: GithubRepoJson): number | null {
  const n = row.stargazers_count ?? row.stargazersCount
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

function mapGithubRepoHits(rows: GithubRepoJson[]): GithubRepoSearchHit[] {
  const hits: GithubRepoSearchHit[] = []
  for (const row of rows) {
    const fullName =
      (typeof row.full_name === 'string' && row.full_name) ||
      (typeof row.fullName === 'string' && row.fullName) ||
      ''
    const [ownerFromFull, nameFromFull] = fullName.split('/')
    const ownerLogin = typeof row.owner === 'string' ? row.owner : row.owner?.login
    const owner = ownerLogin || ownerFromFull
    const name = typeof row.name === 'string' ? row.name : nameFromFull
    if (!owner || !name) continue
    hits.push({
      owner,
      name,
      fullName: fullName || `${owner}/${name}`,
      description: typeof row.description === 'string' ? row.description : null,
      private: Boolean(row.private ?? row.isPrivate),
      stars: parseStarCount(row),
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
        GITHUB_REPO_LIST_JQ,
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

const GITHUB_REPO_QUERY_LIMIT = 20

/** Cached `gh auth token` so later Search API calls skip a CLI spawn. */
let githubAuthToken: string | null | undefined

function primeGithubAuthToken(): void {
  if (githubAuthToken !== undefined) return
  execFile('gh', ['auth', 'token'], { timeout: 4000 }, (error, stdout) => {
    githubAuthToken = error ? null : stdout.trim() || null
  })
}

async function searchGithubRepositoriesViaRest(
  q: string,
): Promise<GithubRepoSearchHit[] | null> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (githubAuthToken) headers.Authorization = `Bearer ${githubAuthToken}`
  try {
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=${GITHUB_REPO_QUERY_LIMIT}`,
      {
        headers,
        signal: AbortSignal.timeout(15000),
      },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { items?: GithubRepoJson[] }
    return Array.isArray(data.items) ? mapGithubRepoHits(data.items) : []
  } catch {
    return null
  }
}

function searchGithubRepositoriesViaGh(q: string): Promise<GithubRepoSearchHit[] | null> {
  return new Promise((resolve) => {
    execFile(
      'gh',
      [
        'search',
        'repos',
        q,
        '--limit',
        String(GITHUB_REPO_QUERY_LIMIT),
        '--json',
        'name,fullName,description,isPrivate,owner,stargazersCount',
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
}

/**
 * Free-text GitHub repository search for the add-project picker.
 * Hits the Search API first (no `gh` spawn). Falls back to `gh search repos`.
 */
export async function searchGithubRepositories(query: string): Promise<GithubRepoSearchHit[]> {
  const q = query.trim().slice(0, 200)
  if (q.length < 2 || /[\u0000-\u001f]/.test(q)) return []

  // Warm the token in the background so the next query can be authenticated.
  primeGithubAuthToken()
  const viaRest = await searchGithubRepositoriesViaRest(q)
  if (viaRest) return viaRest
  return (await searchGithubRepositoriesViaGh(q)) ?? []
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
        GITHUB_REPO_LIST_JQ,
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
