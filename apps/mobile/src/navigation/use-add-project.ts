import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BrowseHostDirectoryResponse,
  CloneRepositoryResponse,
  GithubRepoHit,
  GithubRepoSearchMode,
  RemoteCommand,
  SearchGithubReposResponse,
} from '@superone/shared/agent-types'
import {
  autoAdvanceFromSourceQuery,
  CREATE_ROW_KEY,
  detectAddProjectSource,
  filterGithubHitsByPrefix,
  formatAddProjectError,
  githubRepoNameSearchDelay,
  longestPrefixCacheHits,
  resolveBrowsePath,
  resolveRepoInput,
  type AddProjectSource,
  type AddProjectStep,
} from '@superone/shared/add-project-flow'
import {
  buildGitHubCloneUrl,
  parseGitHubOwnerSearchQuery,
  parseGitHubRepoInput,
  parseGitHubRepoNameSearchQuery,
} from '@superone/shared/git-remote'
import {
  appendBrowsePathSegment,
  ensureBrowseDirectoryPath,
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  joinBrowsePath,
} from '@superone/shared/path-browse'
import {
  ADD_PROJECT_TEXT,
  addProjectPlaceholder,
  addProjectStepTitle,
  directoryRows,
  githubRows,
  githubSearchRows,
  projectRows,
  sourceRows,
  type AddProjectRow,
  type AddProjectSectionModel,
} from '../add-project-state'
import { randomId } from '../ids'
import type { Project } from '../screens/projects-screen'

/** Where browsing starts when nothing has been typed; the host expands it. */
const INITIAL_PATH = '~/'
/** Settle a multi-character paste into one step jump. */
const AUTO_ADVANCE_MS = 120
const OWNER_SEARCH_MS = 200

export interface AddProjectFlow {
  step: AddProjectStep
  title: string
  placeholder: string
  query: string
  setQuery: (value: string) => void
  sections: AddProjectSectionModel[]
  /** Message for the empty body — null while there is something to list. */
  emptyMessage: string | null
  loading: boolean
  busy: boolean
  error: string
  /** Set on the destination step: what the clone will produce. */
  clonePreview: { repoLabel: string; remoteUrl: string; path: string } | null
  shallowClone: boolean
  setShallowClone: (value: boolean) => void
  /** Header action label, or null when this step has nothing to commit. */
  confirmLabel: string | null
  confirm: () => void
  activate: (row: AddProjectRow) => void
  /** True when back should return to a previous step rather than leave the page. */
  canGoBack: boolean
  goBack: () => void
}

/**
 * The desktop add-project dialog as a phone flow.
 *
 * Same four steps and the same pure helpers; what changes is that every
 * filesystem read happens on the paired desktop, and confirming is a header
 * button instead of ⇧↵. The source step also lists the projects the host
 * already has, because on the phone picking and adding are one screen.
 */
export function useAddProject(input: {
  /** Issues one command against the paired host; the preview supplies fixtures. */
  request: (command: RemoteCommand) => Promise<unknown>
  projects: Project[]
  onSelect: (project: Project) => void
  onAdded: (path: string) => void
}): AddProjectFlow {
  const [step, setStep] = useState<AddProjectStep>({ kind: 'source' })
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<Array<{ name: string; path: string }>>([])
  const [listedPath, setListedPath] = useState('')
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseError, setBrowseError] = useState('')
  const [repos, setRepos] = useState<GithubRepoHit[]>([])
  const [searchHits, setSearchHits] = useState<GithubRepoHit[]>([])
  const [githubLoading, setGithubLoading] = useState(false)
  const [githubSearching, setGithubSearching] = useState(false)
  const [githubUnavailable, setGithubUnavailable] = useState(false)
  const [shallowClone, setShallowClone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const browseGeneration = useRef(0)
  const githubGeneration = useRef(0)
  const searchGeneration = useRef(0)
  const searchSentAt = useRef(0)
  const ownerCache = useRef(new Map<string, GithubRepoHit[]>())
  const searchCache = useRef(new Map<string, GithubRepoHit[]>())

  // Held in a ref so a caller passing an inline lambda cannot retrigger every
  // listing effect on each render.
  const requestRef = useRef(input.request)
  requestRef.current = input.request
  const request = useCallback(<T,>(command: RemoteCommand): Promise<T> =>
    requestRef.current(command) as Promise<T>, [])

  const isPathStep = step.kind === 'browse' || step.kind === 'destination'
  const isGithubStep = step.kind === 'repo' && step.source === 'github'
  const directoryQuery = isPathStep ? getBrowseDirectoryPath(query) || INITIAL_PATH : ''

  const goToStep = useCallback((next: AddProjectStep, nextQuery: string) => {
    setStep(next)
    setQuery(nextQuery)
    setEntries([])
    setListedPath('')
    setBrowseError('')
    setError('')
    if (!(next.kind === 'repo' && next.source === 'github')) {
      setRepos([])
      setSearchHits([])
      setGithubLoading(false)
      setGithubSearching(false)
      setGithubUnavailable(false)
    }
  }, [])

  // Directory listing for both path steps.
  useEffect(() => {
    if (!isPathStep) return
    const generation = ++browseGeneration.current
    setBrowseLoading(true)
    setBrowseError('')
    void request<BrowseHostDirectoryResponse>({
      type: 'browse_host_directory', requestId: randomId(), path: directoryQuery,
    }).then((result) => {
      if (generation !== browseGeneration.current) return
      if ('error' in result) {
        setEntries([])
        setListedPath('')
        setBrowseError(result.error)
        return
      }
      setEntries(result.entries)
      setListedPath(result.path)
    }).catch((cause: unknown) => {
      if (generation !== browseGeneration.current) return
      setBrowseError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (generation === browseGeneration.current) setBrowseLoading(false)
    })
  }, [isPathStep, directoryQuery, request])

  const ownerSearch = useMemo(
    () => (isGithubStep ? parseGitHubOwnerSearchQuery(query) : null),
    [isGithubStep, query],
  )
  const githubUrlQuery = useMemo(() => {
    if (!isGithubStep) return false
    const value = query.trim()
    return /^(?:https?:|git@|ssh:)/i.test(value) || /^(?:www\.)?github\.com[/:]/i.test(value)
  }, [isGithubStep, query])
  const isMyReposMode = isGithubStep && !ownerSearch && !githubUrlQuery
  const nameQuery = useMemo(
    () => (isMyReposMode ? parseGitHubRepoNameSearchQuery(query) : null),
    [isMyReposMode, query],
  )

  const loadRepos = useCallback((mode: GithubRepoSearchMode, value: string) => {
    const generation = ++githubGeneration.current
    setGithubLoading(true)
    setGithubUnavailable(false)
    void request<SearchGithubReposResponse>({
      type: 'search_github_repos', requestId: randomId(), mode, value,
    }).then((result) => {
      if (generation !== githubGeneration.current) return
      if ('error' in result) {
        setRepos([])
        return
      }
      if (mode === 'owner') ownerCache.current.set(value.toLowerCase(), result.repos)
      setRepos(result.repos)
      setGithubUnavailable(!!result.unavailable)
    }).catch(() => {
      if (generation === githubGeneration.current) setRepos([])
    }).finally(() => {
      if (generation === githubGeneration.current) setGithubLoading(false)
    })
  }, [request])

  // `owner/` lists that account's repositories; a bare step lists the user's own.
  useEffect(() => {
    if (githubUrlQuery) {
      setRepos([])
      return
    }
    if (isMyReposMode) {
      loadRepos('mine', '')
      return
    }
    if (!ownerSearch) return
    const owner = ownerSearch.owner
    const cached = ownerCache.current.get(owner.toLowerCase())
    if (cached) {
      setRepos(cached)
      setGithubLoading(false)
      return
    }
    const timer = setTimeout(() => loadRepos('owner', owner), OWNER_SEARCH_MS)
    return () => clearTimeout(timer)
  }, [githubUrlQuery, isMyReposMode, ownerSearch?.owner, loadRepos])

  // Free-text search runs alongside the local "your repos" filter.
  useEffect(() => {
    if (!nameQuery) {
      setSearchHits((current) => (current.length ? [] : current))
      setGithubSearching(false)
      return
    }
    const key = nameQuery.toLowerCase()
    const cached = searchCache.current.get(key)
    if (cached) {
      setSearchHits(cached)
      setGithubSearching(false)
      return
    }
    // Reuse a shorter query's hits so the list is never empty while typing.
    const prefix = longestPrefixCacheHits(searchCache.current, key)
    setSearchHits(prefix ? filterGithubHitsByPrefix(prefix, key) : [])

    const generation = ++searchGeneration.current
    setGithubSearching(true)
    const timer = setTimeout(() => {
      searchSentAt.current = Date.now()
      void request<SearchGithubReposResponse>({
        type: 'search_github_repos', requestId: randomId(), mode: 'query', value: nameQuery,
      }).then((result) => {
        if (generation !== searchGeneration.current) return
        const hits = 'error' in result ? [] : result.repos
        searchCache.current.set(key, hits)
        setSearchHits(hits)
      }).catch(() => {
        if (generation === searchGeneration.current) setSearchHits([])
      }).finally(() => {
        if (generation === searchGeneration.current) setGithubSearching(false)
      })
    }, githubRepoNameSearchDelay(Date.now(), searchSentAt.current))
    return () => clearTimeout(timer)
  }, [nameQuery, request])

  // Typing a concrete path on the source step jumps straight into browsing.
  useEffect(() => {
    if (step.kind !== 'source') return
    const advance = autoAdvanceFromSourceQuery(query, INITIAL_PATH)
    if (!advance) return
    const timer = setTimeout(() => goToStep(advance.step, advance.query), AUTO_ADVANCE_MS)
    return () => clearTimeout(timer)
  }, [step.kind, query, goToStep])

  const resolved = useMemo(
    () => resolveBrowsePath({ query, listedPath, entries }),
    [query, listedPath, entries],
  )
  const repoResolved = useMemo(
    () => (step.kind === 'repo' ? resolveRepoInput(step.source, query) : null),
    [step, query],
  )
  const willCreatePath = isPathStep && !browseLoading && resolved.path && !resolved.exists
    ? resolved.path
    : null

  const addProject = useCallback(async (path: string, createIfMissing: boolean) => {
    if (!path) {
      setError(ADD_PROJECT_TEXT.pathRequired)
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await request<{ success?: boolean; error?: string }>({
        type: 'add_project', requestId: randomId(), path, createIfMissing,
      })
      if (result.error) throw new Error(result.error)
      input.onAdded(path)
    } catch (cause) {
      setError(formatAddProjectError(cause, (_key, options) => options?.path
        ? `"${options.path}" already exists. Pick another folder, or add that project instead of cloning.`
        : ADD_PROJECT_TEXT.pathRequired))
    } finally {
      setBusy(false)
    }
  }, [request, input.onAdded])

  const cloneProject = useCallback(async () => {
    if (step.kind !== 'destination' || !resolved.path) return
    setBusy(true)
    setError('')
    try {
      const result = await request<CloneRepositoryResponse>({
        type: 'clone_repository',
        requestId: randomId(),
        remoteUrl: step.remoteUrl,
        parentPath: resolved.path,
        directoryName: step.repoName,
        shallow: shallowClone,
      })
      if ('error' in result) throw new Error(result.error)
      input.onAdded(result.path)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [step, resolved.path, shallowClone, request, input.onAdded])

  const continueWithRepo = useCallback((
    source: Exclude<AddProjectSource, 'local'>,
    repoInput: string,
    remoteUrl: string,
    repoName: string,
  ) => {
    const ref = source === 'github' ? parseGitHubRepoInput(repoInput) : null
    goToStep(
      { kind: 'destination', source, repoInput: ref ? `${ref.owner}/${ref.repo}` : repoInput, remoteUrl, repoName },
      INITIAL_PATH,
    )
  }, [goToStep])

  const activate = useCallback((row: AddProjectRow) => {
    if (step.kind === 'source') {
      if (row.icon === 'project') {
        const project = input.projects.find((item) => item.path === row.key)
        if (project) input.onSelect(project)
        return
      }
      const source = row.key as AddProjectSource
      if (source === 'local') {
        const carry = detectAddProjectSource(query) === 'local' ? query.trim() : ''
        goToStep({ kind: 'browse' }, carry || INITIAL_PATH)
        return
      }
      goToStep({ kind: 'repo', source }, '')
      return
    }
    if (isGithubStep) {
      const [owner, name] = row.key.split('/')
      if (!owner || !name) return
      continueWithRepo('github', row.key, buildGitHubCloneUrl({ owner, repo: name }), name)
      return
    }
    if (row.key === CREATE_ROW_KEY) {
      if (step.kind === 'browse') void addProject(resolved.path, true)
      else void cloneProject()
      return
    }
    setQuery((current) => appendBrowsePathSegment(current, row.key))
  }, [step, isGithubStep, query, input.projects, input.onSelect, goToStep, continueWithRepo, addProject, cloneProject, resolved.path])

  const confirm = useCallback(() => {
    if (step.kind === 'browse') {
      if (resolved.path) void addProject(resolved.path, !resolved.exists)
      return
    }
    if (step.kind === 'destination') {
      void cloneProject()
      return
    }
    if (step.kind === 'repo' && repoResolved) {
      continueWithRepo(step.source, query.trim(), repoResolved.remoteUrl, repoResolved.repoName)
    }
  }, [step, resolved, repoResolved, query, addProject, cloneProject, continueWithRepo])

  const sections = useMemo((): AddProjectSectionModel[] => {
    if (step.kind === 'source') {
      const detected = detectAddProjectSource(query)
      const result: AddProjectSectionModel[] = []
      const projects = projectRows(input.projects, query)
      if (projects.length) {
        result.push({ key: 'projects', label: ADD_PROJECT_TEXT.projects, rows: projects })
      }
      const sources = sourceRows(query, detected)
      if (sources.length) {
        result.push({ key: 'sources', label: ADD_PROJECT_TEXT.sources, rows: sources })
      }
      return result
    }
    if (isGithubStep) {
      if (githubUrlQuery) return []
      const result: AddProjectSectionModel[] = []
      const rows = githubRows(repos, { ownerPrefix: ownerSearch, query })
      if (rows.length) {
        result.push({
          key: ownerSearch ? 'github' : 'github-mine',
          label: isMyReposMode ? ADD_PROJECT_TEXT.githubYourRepos : ADD_PROJECT_TEXT.githubRepos,
          rows,
          icon: isMyReposMode ? 'user' : undefined,
        })
      }
      if (nameQuery) {
        result.push({
          key: 'github-search',
          label: githubSearching ? ADD_PROJECT_TEXT.githubSearching : ADD_PROJECT_TEXT.githubSearchResults,
          rows: githubSearchRows(searchHits, repos, nameQuery),
          searching: githubSearching,
          icon: 'search',
        })
      }
      return result
    }
    if (isPathStep) {
      const result: AddProjectSectionModel[] = [{
        key: 'directories',
        label: ADD_PROJECT_TEXT.directories,
        rows: directoryRows(entries, getBrowseLeafPathSegment(query)),
      }]
      if (willCreatePath) {
        result.push({
          key: 'create',
          label: ADD_PROJECT_TEXT.createSection,
          rows: [{
            key: CREATE_ROW_KEY,
            icon: 'create',
            label: willCreatePath,
            hint: ADD_PROJECT_TEXT.createDirectory,
            wrapLabel: true,
          }],
        })
      }
      return result
    }
    return []
  }, [step, query, input.projects, isGithubStep, githubUrlQuery, repos, ownerSearch, isMyReposMode,
    nameQuery, githubSearching, searchHits, isPathStep, entries, willCreatePath])

  const rowCount = sections.reduce((total, section) => total + section.rows.length, 0)
  const loading = (isPathStep && browseLoading && rowCount === 0) || (isGithubStep && githubLoading)

  const emptyMessage = useMemo(() => {
    if (rowCount || loading) return null
    if (step.kind === 'repo') {
      if (repoResolved) return null
      if (step.source === 'url') return ADD_PROJECT_TEXT.repoInvalidUrl
      if (githubUnavailable) return ADD_PROJECT_TEXT.githubNeedCli
      return ownerSearch || isMyReposMode
        ? ADD_PROJECT_TEXT.githubNoRepos
        : ADD_PROJECT_TEXT.repoInvalidGithub
    }
    if (isPathStep) return browseError || ADD_PROJECT_TEXT.noDirectories
    return null
  }, [rowCount, loading, step, repoResolved, githubUnavailable, ownerSearch, isMyReposMode, isPathStep, browseError])

  const clonePreview = step.kind === 'destination'
    ? {
        repoLabel: step.repoInput,
        remoteUrl: step.remoteUrl,
        path: resolved.path ? joinBrowsePath(resolved.path, step.repoName) : '',
      }
    : null

  const confirmLabel = step.kind === 'browse'
    ? (willCreatePath ? 'Create' : 'Add')
    : step.kind === 'destination'
      ? 'Clone'
      : step.kind === 'repo' && repoResolved
        ? 'Continue'
        : null

  return {
    step,
    title: addProjectStepTitle(step),
    placeholder: addProjectPlaceholder(step),
    query,
    setQuery: (value) => { setQuery(value); setError('') },
    sections,
    emptyMessage,
    loading,
    busy,
    error,
    clonePreview,
    shallowClone,
    setShallowClone,
    confirmLabel,
    confirm,
    activate,
    canGoBack: step.kind !== 'source',
    goBack: () => {
      if (step.kind === 'destination') goToStep({ kind: 'repo', source: step.source }, step.repoInput)
      else goToStep({ kind: 'source' }, '')
    },
  }
}

/** Directory the browser should list for a typed query — exported for tests. */
export function browseDirectoryFor(query: string): string {
  return ensureBrowseDirectoryPath(getBrowseDirectoryPath(query) || INITIAL_PATH)
}
