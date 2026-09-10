import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BrowseHostDirectoryResponse,
  CloneRepositoryResponse,
  DefaultClonePathResponse,
  GithubRepoHit,
  RemoteCommand,
  SearchGithubReposResponse,
} from '@superone/shared/agent-types'
import {
  CREATE_ROW_KEY,
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
  sourceRows,
  type AddProjectRow,
  type AddProjectSectionModel,
} from '../add-project-state'
import { randomId } from '../ids'

/** Where browsing starts when nothing has been typed; the host expands it. */
const INITIAL_PATH = '~/'
const OWNER_SEARCH_MS = 200

export interface AddProjectFlow {
  step: AddProjectStep
  title: string
  /** Null on the source step, which is a pick with no field. */
  placeholder: string | null
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
  saveAsDefault: boolean
  setSaveAsDefault: (value: boolean) => void
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
 * button instead of ⇧↵. Choosing among the projects the host already has is a
 * different screen — this one only adds.
 */
export function useAddProject(input: {
  /** Issues one command against the paired host; the preview supplies fixtures. */
  request: (command: RemoteCommand) => Promise<unknown>
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
  const [githubResultKey, setGithubResultKey] = useState<string | null>(null)
  const [githubSearchResultKey, setGithubSearchResultKey] = useState<string | null>(null)
  const [githubUnavailable, setGithubUnavailable] = useState(false)
  const [shallowClone, setShallowClone] = useState(false)
  const [saveAsDefault, setSaveAsDefault] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const browseGeneration = useRef(0)
  const searchSentAt = useRef(0)
  const ownerCache = useRef(new Map<string, GithubRepoHit[]>())
  const searchCache = useRef(new Map<string, GithubRepoHit[]>())

  // Held in a ref so a caller passing an inline lambda cannot retrigger every
  // listing effect on each render.
  const requestRef = useRef(input.request)
  requestRef.current = input.request
  // An unpaired caller throws where the desktop would answer, and a throw from a
  // listing effect tears the app down instead of reaching the `.catch` below.
  const request = useCallback(<T,>(command: RemoteCommand): Promise<T> =>
    Promise.resolve().then(() => requestRef.current(command)) as Promise<T>, [])

  // The clone parent the host remembers, shared with the desktop dialog.
  const defaultClonePathRef = useRef<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void request<DefaultClonePathResponse>({ type: 'get_default_clone_path', requestId: randomId() })
      .then((result) => {
        if (cancelled || 'error' in result) return
        defaultClonePathRef.current = result.path
      })
      .catch(() => { /* An unsaved default is the normal case. */ })
    return () => { cancelled = true }
  }, [request])

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
      setGithubResultKey(null)
      setGithubSearchResultKey(null)
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

  const githubOwner = ownerSearch?.owner.toLowerCase() ?? ''
  const githubKey = isMyReposMode ? 'mine' : githubOwner ? `owner:${githubOwner}` : null
  const nameKey = nameQuery?.toLowerCase() ?? null
  // A query is pending from its first render, including the debounce before
  // an effect issues the request. Only a result for that query can settle it.
  const githubLoading = githubKey !== null && githubResultKey !== githubKey
  const githubSearching = nameKey !== null && githubSearchResultKey !== nameKey

  // `owner/` lists that account's repositories; a bare step lists the user's own.
  useEffect(() => {
    if (!githubKey) {
      setRepos((current) => current.length ? [] : current)
      setGithubResultKey(null)
      return
    }
    setGithubUnavailable(false)
    const cached = githubOwner ? ownerCache.current.get(githubOwner) : undefined
    if (cached) {
      setRepos(cached)
      setGithubResultKey(githubKey)
      return
    }
    setGithubResultKey(null)
    let cancelled = false
    const load = () => {
      void request<SearchGithubReposResponse>({
        type: 'search_github_repos', requestId: randomId(),
        mode: githubOwner ? 'owner' : 'mine', value: githubOwner,
      }).then((result) => {
        if (cancelled) return
        if ('error' in result) {
          setRepos([])
          return
        }
        if (githubOwner) ownerCache.current.set(githubOwner, result.repos)
        setRepos(result.repos)
        setGithubUnavailable(!!result.unavailable)
      }).catch(() => {
        if (!cancelled) setRepos([])
      }).finally(() => {
        if (!cancelled) setGithubResultKey(githubKey)
      })
    }
    const timer = githubOwner ? setTimeout(load, OWNER_SEARCH_MS) : undefined
    if (!githubOwner) load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [githubKey, githubOwner, request])

  // Free-text search runs alongside the local "your repos" filter.
  useEffect(() => {
    if (!nameKey) {
      setSearchHits((current) => (current.length ? [] : current))
      setGithubSearchResultKey(null)
      return
    }
    const key = nameKey
    const cached = searchCache.current.get(key)
    if (cached) {
      setSearchHits(cached)
      setGithubSearchResultKey(key)
      return
    }
    // Reuse a shorter query's hits so the list is never empty while typing.
    const prefix = longestPrefixCacheHits(searchCache.current, key)
    setSearchHits(prefix ? filterGithubHitsByPrefix(prefix, key) : [])
    setGithubSearchResultKey(null)

    let cancelled = false
    const timer = setTimeout(() => {
      searchSentAt.current = Date.now()
      void request<SearchGithubReposResponse>({
        type: 'search_github_repos', requestId: randomId(), mode: 'query', value: key,
      }).then((result) => {
        if (cancelled) return
        const hits = 'error' in result ? [] : result.repos
        searchCache.current.set(key, hits)
        setSearchHits(hits)
      }).catch(() => {
        if (!cancelled) setSearchHits([])
      }).finally(() => {
        if (!cancelled) setGithubSearchResultKey(key)
      })
    }, githubRepoNameSearchDelay(Date.now(), searchSentAt.current))
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [nameKey, request])

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
      // Persist or clear the remembered parent, exactly as the dialog does.
      const currentDir = ensureBrowseDirectoryPath(query.trim() || resolved.path)
      const saved = defaultClonePathRef.current
      if (saveAsDefault && currentDir) {
        await request({ type: 'set_default_clone_path', requestId: randomId(), path: currentDir })
        defaultClonePathRef.current = currentDir
      } else if (!saveAsDefault && saved && ensureBrowseDirectoryPath(saved) === currentDir) {
        await request({ type: 'set_default_clone_path', requestId: randomId(), path: '' })
        defaultClonePathRef.current = null
      }
      input.onAdded(result.path)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [step, resolved.path, shallowClone, saveAsDefault, query, request, input.onAdded])

  const continueWithRepo = useCallback((
    source: Exclude<AddProjectSource, 'local'>,
    repoInput: string,
    remoteUrl: string,
    repoName: string,
  ) => {
    const ref = source === 'github' ? parseGitHubRepoInput(repoInput) : null
    // Prefill with the saved default so the user can confirm without browsing.
    const saved = defaultClonePathRef.current
    goToStep(
      { kind: 'destination', source, repoInput: ref ? `${ref.owner}/${ref.repo}` : repoInput, remoteUrl, repoName },
      saved ? ensureBrowseDirectoryPath(saved) : INITIAL_PATH,
    )
    setSaveAsDefault(!!saved)
  }, [goToStep])

  const activate = useCallback((row: AddProjectRow) => {
    if (step.kind === 'source') {
      const source = row.key as AddProjectSource
      if (source === 'local') goToStep({ kind: 'browse' }, INITIAL_PATH)
      else goToStep({ kind: 'repo', source }, '')
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
  }, [step, isGithubStep, goToStep, continueWithRepo, addProject, cloneProject, resolved.path])

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
      return [{ key: 'sources', label: ADD_PROJECT_TEXT.sources, rows: sourceRows() }]
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
  }, [step, query, isGithubStep, githubUrlQuery, repos, ownerSearch, isMyReposMode,
    nameQuery, githubSearching, searchHits, isPathStep, entries, willCreatePath])

  const rowCount = sections.reduce((total, section) => total + section.rows.length, 0)
  const loading = (isPathStep && browseLoading && rowCount === 0) || (isGithubStep && githubLoading)

  const emptyMessage = useMemo(() => {
    if (rowCount || loading || githubSearching) return null
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
  }, [rowCount, loading, githubSearching, step, repoResolved, githubUnavailable, ownerSearch, isMyReposMode, isPathStep, browseError])

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
    saveAsDefault,
    setSaveAsDefault,
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
