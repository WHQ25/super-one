import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  buildGitHubCloneUrl,
  githubOwnerAvatarUrl,
  parseGitHubOwnerSearchQuery,
  parseGitHubRepoInput,
} from '@superone/shared/git-remote'
import { fuzzyMatch } from '@/lib/fuzzy-match'
import {
  appendBrowsePathSegment,
  ensureBrowseDirectoryPath,
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  getBrowseParentPath,
  getPathInlineGhost,
  hasTrailingPathSeparator,
  isBareHomePath,
  isBrowseablePathQuery,
  joinBrowsePath,
  normalizeHomePrefixInput,
} from '@/lib/path-browse'
import type { AddProjectListItem, AddProjectListSection } from './AddProjectList'
import {
  ADD_PROJECT_SOURCES,
  autoAdvanceFromSourceQuery,
  describeDetectedSource,
  detectAddProjectSource,
  formatAddProjectError,
  resolveBrowsePath,
  resolveRepoInput,
  type AddProjectSource,
  type AddProjectStep,
} from './add-project-flow'

export type GithubRepoHit = {
  owner: string
  name: string
  fullName: string
  description: string | null
  private: boolean
}

/** Sentinel key for the "go to parent directory" row that leads the path list. */
export const PARENT_ROW_KEY = '..'
/** Sentinel key for "use the current directory" (commit without drilling in). */
export const CURRENT_ROW_KEY = '.'
/** Sentinel key for the "create this missing directory" candidate row. */
export const CREATE_ROW_KEY = '__create__'

type DirEntry = { name: string; path: string; type: 'directory' }

interface UseAddProjectDialogInput {
  open: boolean
  connectionId: string
  onOpenChange: (open: boolean) => void
  onOpened: (project: { projectId: string; path: string; name: string }) => void
  /** Per-source row icons, supplied by the view so this stays JSX-free. */
  sourceIcons: Record<AddProjectSource, ReactNode>
  parentIcon: ReactNode
  directoryIcon: ReactNode
  /** Icon for the "create missing directory" path candidate. */
  createDirectoryIcon: ReactNode
}

/**
 * All state for the add-project dialog: the step machine, the debounced
 * directory listing, and the actions each step commits.
 *
 * Kept apart from the view because a single input box means "what does the
 * current text mean" depends entirely on the step — that branching is the part
 * worth reading (and testing) on its own.
 */
export function useAddProjectDialog(input: UseAddProjectDialogInput) {
  const { open, connectionId, onOpenChange, onOpened } = input
  const { t } = useTranslation()
  const isLocal = connectionId === 'local'
  // Both local and remote accept shell-style `~/`; the node expands `~` to its own home.
  const initialPath = '~/'

  const [step, setStep] = useState<AddProjectStep>({ kind: 'source' })
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [listedPath, setListedPath] = useState('')
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [browseLoading, setBrowseLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [githubRepos, setGithubRepos] = useState<GithubRepoHit[]>([])
  const [githubSearchOwner, setGithubSearchOwner] = useState('')
  const [githubLoading, setGithubLoading] = useState(false)
  const [githubLoadingMore, setGithubLoadingMore] = useState(false)
  const [githubHasMore, setGithubHasMore] = useState(false)
  const [githubError, setGithubError] = useState<string | null>(null)
  /** True when listing my repos failed because `gh` is missing / logged out. */
  const [githubUnavailable, setGithubUnavailable] = useState(false)
  /** Saved default parent dir for this connection (destination step prefill). */
  const [defaultClonePath, setDefaultClonePath] = useState<string | null>(null)
  /** When true, successful clone writes the current path as defaultClonePath. */
  const [saveAsDefault, setSaveAsDefault] = useState(false)
  // Ref tracks the same value so continueWithRepo sees a load that finished
  // after the last render without waiting for another commit.
  const defaultClonePathRef = useRef<string | null>(null)
  const requestIdRef = useRef(0)
  const githubRequestIdRef = useRef(0)
  const githubCacheRef = useRef<Map<string, GithubRepoHit[]>>(new Map())
  const githubMyPageRef = useRef(0)
  const githubLoadingMoreRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const isPathStep = step.kind === 'browse' || step.kind === 'destination'
  const isGithubRepoStep = step.kind === 'repo' && step.source === 'github'

  useEffect(() => {
    if (!open) return
    setStep({ kind: 'source' })
    setQuery('')
    setSelectedIndex(0)
    setEntries([])
    setListedPath('')
    setBrowseError(null)
    setSubmitError('')
    setBusy(false)
    setGithubRepos([])
    setGithubSearchOwner('')
    setGithubLoading(false)
    setGithubLoadingMore(false)
    setGithubHasMore(false)
    setGithubError(null)
    setGithubUnavailable(false)
    setSaveAsDefault(false)
    githubMyPageRef.current = 0
    githubLoadingMoreRef.current = false
    // Focus after paint so Tab completes the path instead of moving focus.
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  // Load the per-connection default clone parent for the destination step.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    defaultClonePathRef.current = null
    setDefaultClonePath(null)
    void window.app.getAppSettings().then((settings) => {
      if (cancelled) return
      const path = settings.defaultClonePaths?.[connectionId]
      const next = typeof path === 'string' && path.trim() ? path.trim() : null
      defaultClonePathRef.current = next
      setDefaultClonePath(next)
    })
    return () => {
      cancelled = true
    }
  }, [open, connectionId])

  const browseDir = useMemo(
    () => (isPathStep ? getBrowseDirectoryPath(query) : ''),
    [isPathStep, query],
  )
  const leafPartial = useMemo(
    () => (isPathStep ? getBrowseLeafPathSegment(query) : ''),
    [isPathStep, query],
  )

  // Directory listing for the two path steps, debounced like MentionPopup.
  useEffect(() => {
    if (!open || !isPathStep) return
    const pathToList = browseDir || query
    if (!isBrowseablePathQuery(pathToList)) {
      setEntries([])
      setListedPath('')
      setBrowseError(null)
      return
    }

    const requestId = ++requestIdRef.current
    setBrowseLoading(true)
    setBrowseError(null)

    const timer = window.setTimeout(() => {
      void window.environment
        .browsePath(connectionId, pathToList)
        .then((res) => {
          if (requestId !== requestIdRef.current) return
          setListedPath(res.path)
          setEntries(res.entries)
        })
        .catch((err) => {
          if (requestId !== requestIdRef.current) return
          setEntries([])
          setListedPath('')
          setBrowseError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setBrowseLoading(false)
        })
    }, 100)

    return () => window.clearTimeout(timer)
  }, [open, isPathStep, connectionId, browseDir, query])

  const githubSearch = useMemo(
    () => (isGithubRepoStep ? parseGitHubOwnerSearchQuery(query) : null),
    [isGithubRepoStep, query],
  )

  /** Full GitHub URL / ssh remote — skip list, show resolved preview (old path). */
  const githubUrlQuery = useMemo(() => {
    if (!isGithubRepoStep) return false
    const value = query.trim()
    if (!value) return false
    return (
      /^(?:https?:\/\/|ssh:\/\/|git@|git:\/\/)/i.test(value) ||
      /^(?:www\.)?github\.com[/:]/i.test(value)
    )
  }, [isGithubRepoStep, query])

  /**
   * Default GitHub view: authenticated viewer's repos via `gh`.
   * Yields to owner/` search and paste-URL resolution (the "old path").
   */
  const isGithubMyReposMode =
    isGithubRepoStep && !githubSearch && !githubUrlQuery

  // Owner search: load that owner's repos once `owner/` is typed (cached).
  useEffect(() => {
    if (!open || !isGithubRepoStep) {
      setGithubRepos([])
      setGithubSearchOwner('')
      setGithubLoading(false)
      setGithubLoadingMore(false)
      setGithubHasMore(false)
      setGithubError(null)
      setGithubUnavailable(false)
      return
    }
    if (!githubSearch) return

    const owner = githubSearch.owner
    const cached = githubCacheRef.current.get(owner.toLowerCase())
    if (cached) {
      setGithubRepos(cached)
      setGithubSearchOwner(owner)
      setGithubLoading(false)
      setGithubLoadingMore(false)
      setGithubHasMore(false)
      setGithubError(null)
      setGithubUnavailable(false)
      return
    }

    const requestId = ++githubRequestIdRef.current
    setGithubLoading(true)
    setGithubLoadingMore(false)
    setGithubHasMore(false)
    setGithubError(null)
    setGithubUnavailable(false)
    setGithubSearchOwner(owner)

    const timer = window.setTimeout(() => {
      void window.app
        .searchGithubRepos(owner)
        .then((rows) => {
          if (requestId !== githubRequestIdRef.current) return
          const hits = rows ?? []
          githubCacheRef.current.set(owner.toLowerCase(), hits)
          setGithubRepos(hits)
        })
        .catch((err) => {
          if (requestId !== githubRequestIdRef.current) return
          setGithubRepos([])
          setGithubError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (requestId === githubRequestIdRef.current) setGithubLoading(false)
        })
    }, 200)

    return () => window.clearTimeout(timer)
  }, [open, isGithubRepoStep, githubSearch?.owner])

  // URL paste: drop any list so the resolved-repo preview can take over.
  useEffect(() => {
    if (!open || !isGithubRepoStep || !githubUrlQuery) return
    setGithubRepos([])
    setGithubSearchOwner('')
    setGithubLoading(false)
    setGithubLoadingMore(false)
    setGithubHasMore(false)
    setGithubError(null)
    setGithubUnavailable(false)
  }, [open, isGithubRepoStep, githubUrlQuery])

  // My repos (gh): first page when entering the GitHub step without owner/ or URL.
  useEffect(() => {
    if (!open || !isGithubMyReposMode) return

    const requestId = ++githubRequestIdRef.current
    setGithubSearchOwner('')
    setGithubLoading(true)
    setGithubLoadingMore(false)
    setGithubError(null)
    setGithubUnavailable(false)
    setGithubHasMore(false)
    githubMyPageRef.current = 0
    githubLoadingMoreRef.current = false

    void window.app
      .listMyGithubRepos(1, 20)
      .then((page) => {
        if (requestId !== githubRequestIdRef.current) return
        setGithubRepos(page.repos)
        setGithubHasMore(page.hasMore)
        setGithubUnavailable(page.unavailable)
        githubMyPageRef.current = 1
      })
      .catch((err) => {
        if (requestId !== githubRequestIdRef.current) return
        setGithubRepos([])
        setGithubHasMore(false)
        setGithubUnavailable(true)
        setGithubError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (requestId === githubRequestIdRef.current) setGithubLoading(false)
      })
  }, [open, isGithubMyReposMode])

  /** Infinite scroll: next page of the authenticated user's repos. */
  const loadMoreGithubRepos = useCallback(() => {
    if (!isGithubMyReposMode) return
    if (!githubHasMore || githubLoading || githubLoadingMoreRef.current) return
    githubLoadingMoreRef.current = true
    setGithubLoadingMore(true)
    const nextPage = githubMyPageRef.current + 1
    const requestId = githubRequestIdRef.current
    void window.app
      .listMyGithubRepos(nextPage, 20)
      .then((page) => {
        if (requestId !== githubRequestIdRef.current) return
        setGithubRepos((prev) => {
          const seen = new Set(prev.map((r) => r.fullName.toLowerCase()))
          const appended = page.repos.filter((r) => !seen.has(r.fullName.toLowerCase()))
          return [...prev, ...appended]
        })
        setGithubHasMore(page.hasMore)
        githubMyPageRef.current = nextPage
      })
      .catch(() => {
        if (requestId !== githubRequestIdRef.current) return
        setGithubHasMore(false)
      })
      .finally(() => {
        githubLoadingMoreRef.current = false
        if (requestId === githubRequestIdRef.current) setGithubLoadingMore(false)
      })
  }, [isGithubMyReposMode, githubHasMore, githubLoading])

  /** What the typed text looks like, so the picker can pre-select its source. */
  const detectedSource = useMemo(
    () => (step.kind === 'source' ? detectAddProjectSource(query) : null),
    [step.kind, query],
  )

  const sourceItems: AddProjectListItem[] = useMemo(() => {
    const rows = ADD_PROJECT_SOURCES.map((source) => ({
      source,
      label: t(`sidebar.addProject.sources.${source}.label`),
      hint: t(`sidebar.addProject.sources.${source}.hint`),
    }))

    // Recognised path content: put Local first with the others still reachable.
    if (detectedSource) {
      return rows
        .sort((a, b) => Number(b.source === detectedSource) - Number(a.source === detectedSource))
        .map((entry) => ({
          key: entry.source,
          icon: input.sourceIcons[entry.source],
          label: entry.label,
          matchIndices: [],
          hint:
            entry.source === detectedSource
              ? (describeDetectedSource(entry.source, query) ?? entry.hint)
              : entry.hint,
        }))
    }

    const filter = query.trim().toLowerCase()
    // Path/repo/url-shaped text is content for a later step, not a source-label
    // search — keep every source visible so the user can still click GitHub/URL.
    const looksLikeContent =
      !filter ||
      filter.includes('/') ||
      filter.includes('\\') ||
      filter.includes(':') ||
      filter.includes('@') ||
      filter.startsWith('~') ||
      filter.startsWith('.')

    if (looksLikeContent) {
      return rows.map((entry) => ({
        key: entry.source,
        icon: input.sourceIcons[entry.source],
        label: entry.label,
        matchIndices: [],
        hint: entry.hint,
      }))
    }

    return rows
      .map((entry) => ({ entry, match: fuzzyMatch(filter, entry.label) }))
      .filter(({ match }) => match.match)
      .sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0))
      .map(({ entry, match }) => ({
        key: entry.source,
        icon: input.sourceIcons[entry.source],
        label: entry.label,
        matchIndices: match?.indices ?? [],
        hint: entry.hint,
      }))
  }, [query, detectedSource, t, input.sourceIcons])

  const pathCandidates = useMemo(() => {
    if (!isPathStep) return []
    if (!leafPartial) return entries.map((entry) => ({ entry, matchIndices: [] as number[] }))
    return entries
      .map((entry) => {
        const r = fuzzyMatch(leafPartial.toLowerCase(), entry.name)
        return { entry, matchIndices: r.indices, score: r.score, matched: r.match }
      })
      .filter((c) => c.matched)
      .sort((a, b) => b.score - a.score)
      .map(({ entry, matchIndices }) => ({ entry, matchIndices }))
  }, [isPathStep, entries, leafPartial])

  /**
   * Parent row only makes sense once a listing succeeded and a parent exists.
   *
   * Derived from what the user typed so `~/Dev/x/` goes up to `~/Dev/`; only
   * when the typed prefix has no segment left to drop (`~/`, `./`) does it fall
   * back to the absolute path the host reported, which can always go up.
   */
  const parentPath = useMemo(() => {
    if (!isPathStep || !listedPath) return null
    return getBrowseParentPath(getBrowseDirectoryPath(query)) ?? getBrowseParentPath(listedPath)
  }, [isPathStep, listedPath, query])

  const resolved = useMemo(
    () => resolveBrowsePath({ query, listedPath, entries }),
    [query, listedPath, entries],
  )
  const repoResolved = useMemo(
    () => (step.kind === 'repo' ? resolveRepoInput(step.source, query) : null),
    [step, query],
  )
  /**
   * Path that will be mkdir'd on submit. Null while listing (existence unknown)
   * or when the resolved directory already exists. Surfaced as its own list
   * group on path steps (and under clone preview on destination).
   */
  const willCreatePath =
    isPathStep && !browseLoading && resolved.path.length > 0 && !resolved.exists
      ? resolved.path
      : null
  const clonePreviewPath =
    step.kind === 'destination' && resolved.path ? joinBrowsePath(resolved.path, step.repoName) : ''

  /**
   * True when the typed path is a complete existing directory (trailing slash /
   * bare `~`) so Enter can commit it via the "." row rather than drilling in.
   */
  const canUseCurrentDirectory =
    isPathStep &&
    !browseLoading &&
    !leafPartial &&
    Boolean(listedPath) &&
    resolved.exists &&
    resolved.path.length > 0 &&
    (hasTrailingPathSeparator(query.trim()) || isBareHomePath(query.trim()))

  /** Directory rows only (current / parent / children) — create is separate. */
  const directoryItems: AddProjectListItem[] = useMemo(() => {
    if (!isPathStep) return []
    const rows: AddProjectListItem[] = []
    // Lead with "use this folder" so default selection + Enter commits the
    // current path instead of navigating into the first child.
    if (canUseCurrentDirectory) {
      rows.push({
        key: CURRENT_ROW_KEY,
        icon: input.directoryIcon,
        label: '.',
        hint: t(
          step.kind === 'destination'
            ? 'sidebar.addProject.cloneHere'
            : 'sidebar.addProject.addThisFolder',
        ),
      })
    }
    if (parentPath !== null && !leafPartial) {
      rows.push({
        key: PARENT_ROW_KEY,
        icon: input.parentIcon,
        label: '..',
        hint: t('sidebar.addProject.goUp'),
      })
    }
    for (const candidate of pathCandidates) {
      // Keyed by name, not by absolute path: navigation appends this segment to
      // whatever prefix the user typed. Names are unique within one directory.
      rows.push({
        key: candidate.entry.name,
        icon: input.directoryIcon,
        label: candidate.entry.name,
        matchIndices: candidate.matchIndices,
      })
    }
    return rows
  }, [
    isPathStep,
    canUseCurrentDirectory,
    step.kind,
    parentPath,
    leafPartial,
    pathCandidates,
    t,
    input.parentIcon,
    input.directoryIcon,
  ])

  /**
   * GitHub list rows: owner/` prefix filter, or free-text filter over my repos.
   * URL paste leaves this empty so the resolved preview can show instead.
   */
  const githubItems: AddProjectListItem[] = useMemo(() => {
    if (!isGithubRepoStep || githubUrlQuery) return []
    if (!githubSearch && !isGithubMyReposMode) return []

    const filter = githubSearch
      ? githubSearch.repoPrefix.toLowerCase()
      : query.trim().toLowerCase()

    return githubRepos
      .map((repo) => {
        // Owner search matches fullName; my-repos filter matches name or fullName.
        const haystack = githubSearch
          ? repo.fullName
          : filter.includes('/')
            ? repo.fullName
            : repo.name
        const match = filter
          ? fuzzyMatch(filter, haystack)
          : { match: true, score: 0, indices: [] as number[] }
        // For my-repos name-only filter, rematch fullName for highlight when needed.
        const label = repo.fullName
        const labelMatch =
          filter && !githubSearch && !filter.includes('/')
            ? fuzzyMatch(filter, label)
            : match
        return { repo, match, labelMatch }
      })
      .filter(({ match }) => match.match)
      .sort((a, b) => (b.match.score ?? 0) - (a.match.score ?? 0))
      .slice(0, githubSearch ? 50 : 200)
      .map(({ repo, labelMatch }) => ({
        key: repo.fullName,
        // Same avatar URL marketplace uses for GitHub-hosted sources.
        icon: createElement('img', {
          src: githubOwnerAvatarUrl(repo.owner, 40),
          alt: '',
          className: 'size-4 rounded-sm object-cover',
          loading: 'lazy',
          referrerPolicy: 'no-referrer',
        }),
        label: repo.fullName,
        matchIndices: labelMatch.indices,
        hint: repo.private
          ? t('sidebar.addProject.githubPrivate')
          : (repo.description ?? undefined),
      }))
  }, [
    isGithubRepoStep,
    githubUrlQuery,
    githubSearch,
    isGithubMyReposMode,
    githubRepos,
    query,
    t,
  ])

  const listSections: AddProjectListSection[] = useMemo(() => {
    if (step.kind === 'source') {
      return sourceItems.length
        ? [{ key: 'sources', label: t('sidebar.addProject.sources.title'), items: sourceItems }]
        : []
    }
    if (isGithubRepoStep) {
      if (githubItems.length === 0) return []
      return [
        {
          key: 'github',
          label: t(
            isGithubMyReposMode
              ? 'sidebar.addProject.githubYourRepos'
              : 'sidebar.addProject.githubRepos',
          ),
          items: githubItems,
        },
      ]
    }
    if (isPathStep) {
      const sections: AddProjectListSection[] = []
      // Directories first so Tab-complete / default selection still hit folder
      // rows; create is a separate trailing group when the typed path is missing.
      if (directoryItems.length > 0) {
        sections.push({
          key: 'directories',
          label: t('sidebar.addProject.directories'),
          items: directoryItems,
        })
      }
      if (willCreatePath) {
        sections.push({
          key: 'create',
          label: t('sidebar.addProject.createSection'),
          items: [
            {
              key: CREATE_ROW_KEY,
              icon: input.createDirectoryIcon,
              label: willCreatePath,
              hint: t('sidebar.addProject.createDirectory'),
              // Long absolute paths must stay fully visible — wrap instead of truncate.
              wrapLabel: true,
            },
          ],
        })
      }
      return sections
    }
    return []
  }, [
    step.kind,
    sourceItems,
    isGithubRepoStep,
    isGithubMyReposMode,
    githubItems,
    isPathStep,
    willCreatePath,
    directoryItems,
    t,
    input.createDirectoryIcon,
  ])

  const items = useMemo(
    () => listSections.flatMap((section) => section.items),
    [listSections],
  )
  const itemCount = items.length
  const safeSelectedIndex = itemCount === 0 ? 0 : Math.max(0, Math.min(selectedIndex, itemCount - 1))

  const goToStep = useCallback((next: AddProjectStep, nextQuery: string) => {
    setStep(next)
    setQuery(nextQuery)
    setSelectedIndex(0)
    setEntries([])
    setListedPath('')
    setBrowseError(null)
    setSubmitError('')
    if (next.kind !== 'repo' || next.source !== 'github') {
      setGithubRepos([])
      setGithubSearchOwner('')
      setGithubLoading(false)
      setGithubError(null)
    }
  }, [])

  const continueWithRepo = useCallback(
    (source: 'github' | 'url', repoInput: string, remoteUrl: string, repoName: string) => {
      // Prefill with the saved default so the user can confirm without re-browsing.
      const saved = defaultClonePathRef.current
      const dest = saved ? ensureBrowseDirectoryPath(saved) : initialPath
      // Normalize a pasted GitHub URL to owner/repo so destination matches search hits.
      const githubRef = source === 'github' ? parseGitHubRepoInput(repoInput) : null
      const displayInput = githubRef ? `${githubRef.owner}/${githubRef.repo}` : repoInput
      goToStep(
        {
          kind: 'destination',
          source,
          repoInput: displayInput,
          remoteUrl,
          repoName,
        },
        dest,
      )
      setSaveAsDefault(Boolean(saved))
    },
    [goToStep, initialPath],
  )

  /**
   * Concrete path / repository text skips the source picker entirely.
   * Debounced so a multi-character paste settles as one jump, and so mid-type
   * fragments (e.g. a half-typed URL) do not thrash the step machine.
   */
  useEffect(() => {
    if (!open || step.kind !== 'source') return
    const advance = autoAdvanceFromSourceQuery(query, initialPath)
    if (!advance) return

    const timer = window.setTimeout(() => {
      goToStep(advance.step, advance.query)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [open, step.kind, query, initialPath, goToStep])

  const goBack = useCallback(() => {
    if (step.kind === 'destination') {
      goToStep({ kind: 'repo', source: step.source }, step.repoInput)
      return
    }
    goToStep({ kind: 'source' }, '')
  }, [step, goToStep])

  // Local browse has no back button — empty path is the way home to the source picker.
  useEffect(() => {
    if (!open || step.kind !== 'browse') return
    if (query.trim() !== '') return
    goToStep({ kind: 'source' }, '')
  }, [open, step.kind, query, goToStep])

  /**
   * `carry` is the already-typed text when it matched this source — it moves on
   * verbatim (no separator fixups) so a half-typed leaf still resolves against
   * the parent listing on the next step.
   */
  const pickSource = useCallback(
    (source: AddProjectSource, carry = '') => {
      const text = carry.trim()
      if (source === 'local') {
        goToStep({ kind: 'browse' }, text || initialPath)
        return
      }
      goToStep({ kind: 'repo', source }, text)
    },
    [goToStep, initialPath],
  )

  /** Jump to a known directory path (parent row, native picker). */
  const navigateTo = useCallback((dirPath: string) => {
    setQuery(ensureBrowseDirectoryPath(dirPath))
    setSelectedIndex(0)
    setSubmitError('')
  }, [])

  /**
   * Enter a directory: the same Tab-completion behaviour as MentionPopup.
   *
   * Appends the folder name to the typed prefix rather than jumping to the
   * absolute path the host reported, so `~/Dev` stays `~/Dev` after completing.
   */
  const navigateIntoSegment = useCallback((segment: string) => {
    setQuery((current) => appendBrowsePathSegment(current, segment))
    setSelectedIndex(0)
    setSubmitError('')
  }, [])

  const addProject = useCallback(
    async (path: string, createIfMissing: boolean) => {
      if (!path) {
        setSubmitError(t('sidebar.addProject.pathRequired'))
        return
      }
      setBusy(true)
      setSubmitError('')
      try {
        const project = await window.environment.openProject(connectionId, path, {
          createIfMissing,
        })
        onOpened(project)
        onOpenChange(false)
      } catch (err) {
        setSubmitError(formatAddProjectError(err, t))
      } finally {
        setBusy(false)
      }
    },
    [connectionId, onOpened, onOpenChange, t],
  )

  /**
   * @param parentPathOverride — absolute parent from the native folder picker
   *   (skips waiting for `resolved` to catch up after a programmatic setQuery).
   */
  const cloneProject = useCallback(
    async (parentPathOverride?: string) => {
      if (step.kind !== 'destination') return
      const parentPath = parentPathOverride ?? resolved.path
      if (!parentPath) return
      setBusy(true)
      setSubmitError('')
      try {
        const project = await window.environment.cloneRepository(connectionId, {
          remoteUrl: step.remoteUrl,
          parentPath,
          directoryName: step.repoName,
        })
        // Persist (or clear) the default clone parent after a successful clone.
        const currentDir = ensureBrowseDirectoryPath(
          parentPathOverride ?? (query.trim() || parentPath),
        )
        if (saveAsDefault && currentDir) {
          await window.app.saveAppSettings({
            defaultClonePaths: { [connectionId]: currentDir },
          })
          defaultClonePathRef.current = currentDir
          setDefaultClonePath(currentDir)
        } else if (
          !saveAsDefault &&
          defaultClonePath &&
          ensureBrowseDirectoryPath(defaultClonePath) === currentDir
        ) {
          // Unchecked while still on the saved default → clear it.
          await window.app.saveAppSettings({
            defaultClonePaths: { [connectionId]: '' },
          })
          defaultClonePathRef.current = null
          setDefaultClonePath(null)
        }
        onOpened(project)
        onOpenChange(false)
      } catch (err) {
        setSubmitError(formatAddProjectError(err, t))
      } finally {
        setBusy(false)
      }
    },
    [
      step,
      resolved.path,
      connectionId,
      onOpened,
      onOpenChange,
      t,
      query,
      saveAsDefault,
      defaultClonePath,
    ],
  )

  const activateItem = useCallback(
    (index: number) => {
      const item = items[index]
      if (!item) return
      if (step.kind === 'source') {
        const source = item.key as AddProjectSource
        // Only a detected local path carries the typed text; other sources start clean.
        pickSource(source, source === detectedSource ? query : '')
        return
      }
      if (isGithubRepoStep) {
        const [owner, name] = item.key.split('/')
        if (!owner || !name) return
        continueWithRepo(
          'github',
          item.key,
          buildGitHubCloneUrl({ owner, repo: name }),
          name,
        )
        return
      }
      if (item.key === CURRENT_ROW_KEY || item.key === CREATE_ROW_KEY) {
        // Commit the typed path: create row forces mkdir; current row never does.
        if (step.kind === 'browse') {
          void addProject(resolved.path, item.key === CREATE_ROW_KEY)
          return
        }
        if (step.kind === 'destination') {
          void cloneProject()
          return
        }
        return
      }
      if (item.key === PARENT_ROW_KEY) {
        if (parentPath) navigateTo(parentPath)
        return
      }
      navigateIntoSegment(item.key)
    },
    [
      items,
      step.kind,
      isGithubRepoStep,
      pickSource,
      detectedSource,
      query,
      continueWithRepo,
      addProject,
      resolved.path,
      cloneProject,
      parentPath,
      navigateTo,
      navigateIntoSegment,
    ],
  )

  const submit = useCallback(() => {
    switch (step.kind) {
      case 'source':
        activateItem(safeSelectedIndex)
        return
      case 'repo': {
        // Prefer the highlighted GitHub search hit when the list is showing.
        if (step.source === 'github' && itemCount > 0) {
          activateItem(safeSelectedIndex)
          return
        }
        if (!repoResolved) return
        continueWithRepo(step.source, query.trim(), repoResolved.remoteUrl, repoResolved.repoName)
        return
      }
      case 'browse':
      case 'destination':
        // Path steps: Enter always follows the highlighted list row (navigate,
        // create, or use current). Fall back to committing the typed path only
        // when the list is empty.
        if (itemCount > 0) {
          activateItem(safeSelectedIndex)
          return
        }
        if (step.kind === 'browse') {
          if (resolved.path) void addProject(resolved.path, !resolved.exists)
          return
        }
        void cloneProject()
        return
    }
  }, [
    step,
    activateItem,
    safeSelectedIndex,
    itemCount,
    repoResolved,
    query,
    continueWithRepo,
    addProject,
    resolved,
    cloneProject,
  ])

  /**
   * Inline ghost for the highlighted directory row:
   * - prefix: `~/Deve` + dim `loper`
   * - fuzzy: rebuild leaf from candidate with matched chars solid, rest dim
   */
  const pathInlineGhost = useMemo(() => {
    if (!isPathStep) return null
    const item = items[safeSelectedIndex]
    if (!item) return null
    if (
      item.key === CREATE_ROW_KEY ||
      item.key === CURRENT_ROW_KEY ||
      item.key === PARENT_ROW_KEY
    ) {
      return null
    }
    const leaf = getBrowseLeafPathSegment(query)
    const isPrefix =
      !leaf || item.key.toLowerCase().startsWith(leaf.toLowerCase())
    const fuzzy = !isPrefix && leaf ? fuzzyMatch(leaf, item.key) : null
    return getPathInlineGhost(
      query,
      item.key,
      fuzzy?.match ? fuzzy.indices : null,
    )
  }, [isPathStep, items, safeSelectedIndex, query])

  /** Tab commits the ghost / selected directory into the input (never submits). */
  const completePath = useCallback(() => {
    const selected = items[safeSelectedIndex]
    const item =
      selected &&
      selected.key !== CREATE_ROW_KEY &&
      selected.key !== CURRENT_ROW_KEY
        ? selected
        : items.find(
            (row) =>
              row.key !== CREATE_ROW_KEY &&
              row.key !== CURRENT_ROW_KEY &&
              row.key !== PARENT_ROW_KEY,
          )
    if (!item) return
    if (item.key === PARENT_ROW_KEY) {
      if (parentPath) navigateTo(parentPath)
      return
    }
    // Exact leaf already typed: only add the trailing separator.
    const leaf = getBrowseLeafPathSegment(query)
    if (
      leaf &&
      leaf.toLowerCase() === item.key.toLowerCase() &&
      !hasTrailingPathSeparator(query)
    ) {
      setQuery(ensureBrowseDirectoryPath(query))
      setSelectedIndex(0)
      setSubmitError('')
      return
    }
    navigateIntoSegment(item.key)
  }, [items, safeSelectedIndex, parentPath, navigateTo, navigateIntoSegment, query])

  /**
   * System folder picker: open at the directory the user is already browsing,
   * then commit immediately (add project / clone into parent) — no second confirm.
   */
  const pickNativeFolder = useCallback(async () => {
    // Prefer the absolute path the host listed; fall back to a resolved existing
    // path so the picker lands next to the typed location rather than $HOME.
    const defaultPath =
      listedPath || (resolved.exists && resolved.path ? resolved.path : undefined) || undefined
    const picked = await window.app.selectFolder(defaultPath)
    if (!picked) return
    if (step.kind === 'browse') {
      void addProject(picked, false)
      return
    }
    if (step.kind === 'destination') {
      void cloneProject(picked)
    }
  }, [
    listedPath,
    resolved.exists,
    resolved.path,
    step.kind,
    addProject,
    cloneProject,
  ])

  const moveSelection = useCallback(
    (delta: number) => {
      if (itemCount === 0) return
      setSelectedIndex((i) => Math.max(0, Math.min(i + delta, itemCount - 1)))
    },
    [itemCount],
  )

  const canSubmit =
    !busy &&
    (step.kind === 'source'
      ? itemCount > 0
      : step.kind === 'repo'
        ? step.source === 'github'
          ? itemCount > 0 || repoResolved !== null
          : repoResolved !== null
        : resolved.path.length > 0)

  return {
    step,
    query,
    setQuery: (next: string) => {
      // First keystroke `~` becomes `~/` so the user can keep typing a path.
      setQuery((previous) => normalizeHomePrefixInput(previous, next))
      setSelectedIndex(0)
      setSubmitError('')
    },
    isLocal,
    isPathStep,
    isGithubRepoStep,
    inputRef,
    items,
    listSections,
    itemCount,
    selectedIndex: safeSelectedIndex,
    setSelectedIndex,
    moveSelection,
    browseLoading,
    browseError,
    githubLoading,
    githubLoadingMore,
    githubHasMore,
    githubError,
    githubUnavailable,
    githubSearchOwner,
    githubUrlQuery,
    isGithubMyReposMode,
    loadMoreGithubRepos,
    busy,
    submitError,
    resolved,
    repoResolved,
    willCreatePath,
    clonePreviewPath,
    pathInlineGhost,
    saveAsDefault,
    setSaveAsDefault,
    canSubmit,
    activateItem,
    completePath,
    goBack,
    submit,
    pickNativeFolder,
  }
}
