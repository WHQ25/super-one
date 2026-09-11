import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { BrowseHostDirectoryResponse, HarnessId, RemoteCommand } from '@superone/shared/agent-types'
import {
  appendBrowsePathSegment, getBrowseDirectoryPath, normalizeHomePrefixInput,
} from '@superone/shared/path-browse'
import { resolveBrowsePath } from '@superone/shared/add-project-flow'
import { randomId } from '../ids'
import { requestHarnessResource } from '../harness-resource-cache'
import { ADD_DIR_TEXT, type AddDirScope, type AddDirStep } from '../add-dir-state'
import { additionalDirsFromEvents } from '../additional-dirs-events'

/** Why the host refused a folder, in words a phone can act on. */
const REFUSALS: Record<string, string> = {
  'not-found': 'No folder at that path',
  'not-directory': 'That path is a file, not a folder',
  'same-as-project': 'The agent already has the project root',
  'same-repo': 'Already inside this repository — the agent can read it',
  'session-not-found': 'That session is no longer running',
}

function refusalMessage(reason: unknown): string {
  return typeof reason === 'string' ? REFUSALS[reason] ?? reason : 'Could not add that folder'
}

const OVERVIEW: AddDirStep = { kind: 'overview' }
type Entry = { name: string; path: string }

/**
 * The state behind the additional-folders page.
 *
 * It lives here rather than in the screen because two things outside the screen
 * need it: `create_session` has to carry the session folders picked before there
 * was a session, and the raw event batch is what keeps both lists honest while
 * the page is shut.
 *
 * Browsing is Add Project's, down to the command: `browse_host_directory` plus
 * `resolveBrowsePath`, so a typed path, a tapped row and a pasted absolute path
 * resolve by one rule on the host rather than three guesses on the phone.
 * Unlike Add Project there is no "create this folder" row — the host only
 * accepts a directory that already exists, so `resolved.exists` gates the
 * confirm instead of offering to make one.
 *
 * **Project** folders are re-read from the host after every write rather than
 * patched locally: the new-session landing has no runtime subscribed, so
 * `additional_dirs_changed` never reaches it there, and a locally patched list
 * would drift the moment a write half-failed.
 *
 * **Session** folders have no host to write to before the session exists. Until
 * `create_session` they are held here and travel with it — the same thing the
 * desktop's draft session does.
 */
export function useAdditionalDirs(opts: {
  clientRef: RefObject<RelayClient | null>
  projectPath?: string
  provider: HarnessId
  /** The live session, or `undefined` on the new-session landing. */
  sessionId?: string | null
  /** What the project currently carries — the other half of the effective set. */
  projectDirs: readonly string[]
  onDirs: (dirs: string[]) => void
}) {
  const [step, setStep] = useState<AddDirStep>(OVERVIEW)
  const [query, setQuery] = useState('')
  const [sessionDirs, setSessionDirs] = useState<string[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  /** The absolute directory the host says it listed — what relative input meant. */
  const [listedPath, setListedPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)

  const browsing = step.kind === 'browse'
  // Only the directory portion is fetched; the segment after it filters what
  // came back, so typing deeper into one folder costs no round trip.
  const directoryQuery = browsing ? getBrowseDirectoryPath(query) : null

  useEffect(() => {
    const client = opts.clientRef.current
    if (directoryQuery === null || !client) {
      generation.current++
      setEntries([])
      setListedPath('')
      setLoading(false)
      return
    }
    const request = ++generation.current
    setLoading(true)
    void client.request({ type: 'browse_host_directory', requestId: randomId(), path: directoryQuery } as RemoteCommand)
      .then((response) => {
        if (request !== generation.current) return
        const result = response as BrowseHostDirectoryResponse
        if ('error' in result) { setEntries([]); setListedPath(''); setError(result.error); return }
        setEntries(result.entries)
        setListedPath(result.path)
      })
      .catch((cause: unknown) => {
        if (request !== generation.current) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { if (request === generation.current) setLoading(false) })
  }, [opts.clientRef, directoryQuery])

  /** What the field currently points at, and whether the host has it. */
  const resolved = useMemo(
    () => browsing ? resolveBrowsePath({ query, listedPath, entries }) : { path: '', exists: false },
    [browsing, query, listedPath, entries],
  )

  /** Re-read the host's project list; one refresh serves every project write. */
  const reread = async (client: RelayClient, projectPath: string) => {
    const resources = await requestHarnessResource(client, 'get_project_resources', projectPath, opts.provider, true)
    opts.onDirs(resources?.workspaceDirs ?? [])
  }

  const write = async (command: RemoteCommand, after?: () => void) => {
    const client = opts.clientRef.current
    const projectPath = opts.projectPath
    if (!client || !projectPath) return
    setBusy(true)
    setError('')
    try {
      const result = await client.request(command) as { ok?: boolean; reason?: unknown; error?: string }
      if (result.error) throw new Error(result.error)
      if (result.ok === false) { setError(refusalMessage(result.reason)); return }
      if (after) after()
      else await reread(client, projectPath)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the desktop')
    } finally {
      setBusy(false)
    }
  }

  const setSession = async (dirs: string[]) => {
    const sessionId = opts.sessionId
    // No session yet: these folders are part of what starts one, so they are
    // held here and handed to `create_session` rather than written to a host
    // that has nothing to write them to.
    if (!sessionId) { setSessionDirs(dirs); setError(''); return true }
    return write({
      type: 'set_session_additional_dirs',
      requestId: randomId(),
      projectPath: opts.projectPath ?? '',
      sessionId,
      dirs,
    }, () => setSessionDirs(dirs))
  }

  const add = (dir: string, scope: AddDirScope) => {
    if (!dir || !opts.projectPath) return Promise.resolve(undefined)
    if (scope === 'session') {
      return sessionDirs.includes(dir) ? Promise.resolve(true) : setSession([...sessionDirs, dir])
    }
    return write({
      type: 'add_project_additional_dir',
      requestId: randomId(),
      projectPath: opts.projectPath,
      dir,
      provider: opts.provider,
    })
  }

  return {
    step,
    query,
    entries,
    /** The folder the confirm would add — empty until the host has one. */
    resolvedPath: resolved.exists ? resolved.path : '',
    sessionDirs,
    loading,
    busy,
    error,
    /** Typing `~` on its own expands to `~/`, as it does in Add Project. */
    setQuery: (value: string) => { setQuery((current) => normalizeHomePrefixInput(current, value)); setError('') },
    /** Tapping a folder appends its segment to whatever prefix is typed. */
    enter: (name: string) => { setQuery((current) => appendBrowsePathSegment(current, name)); setError('') },
    /** Pick a scope: that choice is what opens the browser. */
    browse: (scope: AddDirScope) => {
      setStep({ kind: 'browse', scope })
      setQuery(ADD_DIR_TEXT.initialPath)
      setError('')
    },
    /** True while back belongs to this page rather than leaving it. */
    canGoBack: browsing,
    goBack: () => { setStep(OVERVIEW); setQuery(''); setError('') },
    /** Leaving the page entirely: the next visit starts at the overview. */
    reset: () => { setStep(OVERVIEW); setQuery(''); setError(''); setEntries([]); setListedPath('') },
    /** Commit whatever the field resolves to, and unwind on success only. */
    confirm: async () => {
      if (!browsing || !resolved.exists) return
      if (await add(resolved.path, step.scope)) { setStep(OVERVIEW); setQuery('') }
    },
    /**
     * The host's own account of both scopes, off the raw event batch — the
     * landing has no runtime to ingest it, and the page must survive a change
     * made from the desktop while it is open.
     */
    ingest: (events: readonly unknown[]) => {
      const report = additionalDirsFromEvents(events, {
        projectPath: opts.projectPath, sessionId: opts.sessionId, projectDirs: opts.projectDirs,
      })
      if (report.projectDirs) opts.onDirs(report.projectDirs)
      if (report.sessionDirs) setSessionDirs(report.sessionDirs)
    },
    /** Forget a session's own folders; the next session starts with none. */
    clearSessionDirs: () => setSessionDirs([]),
    restoreSessionDirs: setSessionDirs,
    remove: (dir: string, scope: AddDirScope) => {
      if (scope === 'session') return setSession(sessionDirs.filter((entry) => entry !== dir))
      return write({
        type: 'remove_project_additional_dir',
        requestId: randomId(),
        projectPath: opts.projectPath ?? '',
        dir,
        provider: opts.provider,
      })
    },
  }
}
