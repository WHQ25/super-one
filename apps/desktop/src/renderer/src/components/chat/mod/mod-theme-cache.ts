import { parseModBackdropProps, type ModBackdropSnapshot } from '@superone/chat-view/mod-ui'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'

/**
 * The last mod theme each session and project showed, so a pane can paint it
 * before its session's CLI attaches and answers. The theme mod owns the choice
 * and where it applies; this only remembers what it drew. A live answer always
 * wins over what is remembered here.
 */

export interface ModThemeValues {
  backdrop: ModBackdropSnapshot
  theme: Record<string, unknown>
}

export type ModThemeKind = keyof ModThemeValues

export interface ModThemeKey {
  sessionId?: string | null
  projectPath?: string | null
}

export interface RecalledModTheme {
  backdrop: ModBackdropSnapshot | null
  theme: Record<string, unknown> | null
}

/**
 * In a session row, `null` means the mod took that kind away in this session:
 * the project's theme does not show through. A missing kind means unknown.
 */
interface Row {
  backdrop?: ModBackdropSnapshot | null
  theme?: Record<string, unknown> | null
  at: number
}

interface CacheState {
  session: Record<string, Row>
  project: Record<string, Row>
}

const STORAGE_KEY = 'superone:mod-theme-cache:v3'
const LEGACY_STORAGE_KEYS = ['superone:mod-theme-cache:v2']
const MAX_SESSIONS = 200
const MAX_PROJECTS = 50
const NOTHING: RecalledModTheme = { backdrop: null, theme: null }

let state: CacheState = { session: {}, project: {} }
let loaded = false
let clock = 0
const listeners = new Set<() => void>()

function normalizePath(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  return trimmed || path.trim()
}

/** Project identity, per host: a remote project never shares a local one's theme. */
export function modThemeProjectKey(projectPath: string | null | undefined): string | null {
  if (!projectPath?.trim()) return null
  const remote = parseRemoteProjectKey(projectPath)
  return `${remote?.connectionId ?? 'local'}\0${normalizePath(remote ? remote.path : projectPath)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTable(value: unknown): Record<string, Row> {
  if (!isRecord(value)) return {}
  const table: Record<string, Row> = {}
  for (const [key, row] of Object.entries(value)) {
    if (isRecord(row)) table[key] = { ...row, at: typeof row.at === 'number' ? row.at : 0 } as Row
  }
  return table
}

function load(): void {
  if (loaded || typeof localStorage === 'undefined') return
  loaded = true
  try {
    for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key)
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Partial<CacheState>
    state = { session: readTable(parsed.session), project: readTable(parsed.project) }
    clock = Math.max(0, ...Object.values(state.session).map((r) => r.at), ...Object.values(state.project).map((r) => r.at))
  } catch {
    state = { session: {}, project: {} }
  }
}

function save(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // A full disk must not break the live pane.
  }
}

/** Keeps the most recently written rows. */
function prune(table: Record<string, Row>, max: number): Record<string, Row> {
  const keys = Object.keys(table)
  if (keys.length <= max) return table
  const kept = keys.sort((a, b) => table[b].at - table[a].at).slice(0, max)
  return Object.fromEntries(kept.map((key) => [key, table[key]]))
}

/** What tells two remembered values apart without comparing whole pictures. */
function fingerprint(kind: ModThemeKind, value: ModThemeValues[ModThemeKind] | null | undefined): string {
  if (!value) return ''
  try {
    if (kind === 'theme') return JSON.stringify(value)
    const props = parseModBackdropProps((value as ModBackdropSnapshot).result.props)
    return JSON.stringify([props?.id, props?.colorScheme, props?.glass])
  } catch {
    return ''
  }
}

function commit(next: CacheState): void {
  state = next
  save()
  for (const listener of listeners) listener()
}

function sessionKeyOf(key: ModThemeKey): string | null {
  return key.sessionId?.trim() || null
}

export function subscribeModThemeCache(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getModThemeCache(): CacheState {
  load()
  return state
}

/** What this session (else its project) last showed. */
export function recallModTheme(cache: CacheState, key: ModThemeKey): RecalledModTheme {
  const session = sessionKeyOf(key)
  const project = modThemeProjectKey(key.projectPath)
  const own = session ? cache.session[session] : undefined
  const shared = project ? cache.project[project] : undefined
  if (!own && !shared) return NOTHING
  const pick = <K extends ModThemeKind>(kind: K): ModThemeValues[K] | null => {
    if (own && kind in own) return (own[kind] ?? null) as ModThemeValues[K] | null
    return (shared?.[kind] ?? null) as ModThemeValues[K] | null
  }
  return { backdrop: pick('backdrop'), theme: pick('theme') }
}

/** A session showed `value`: remember it for the session and its project. */
export function rememberModTheme<K extends ModThemeKind>(key: ModThemeKey, kind: K, value: ModThemeValues[K]): void {
  load()
  const print = fingerprint(kind, value)
  const session = sessionKeyOf(key)
  const project = modThemeProjectKey(key.projectPath)
  const sessionRow = session ? state.session[session] : undefined
  const projectRow = project ? state.project[project] : undefined
  const sessionFresh = !session || (!!sessionRow && kind in sessionRow && fingerprint(kind, sessionRow[kind]) === print)
  const projectFresh = !project || fingerprint(kind, projectRow?.[kind]) === print
  if (sessionFresh && projectFresh) return
  clock += 1
  const next: CacheState = { ...state }
  if (session && !sessionFresh) next.session = prune({ ...state.session, [session]: { ...sessionRow, [kind]: value, at: clock } }, MAX_SESSIONS)
  if (project && !projectFresh) next.project = prune({ ...state.project, [project]: { ...projectRow, [kind]: value, at: clock } }, MAX_PROJECTS)
  commit(next)
}

/**
 * The mod took `previous` away in this session. The session shows nothing of
 * that kind from now on; the project forgets it only if it still holds that
 * same value, since another session may have set something newer.
 */
export function forgetModTheme<K extends ModThemeKind>(key: ModThemeKey, kind: K, previous: ModThemeValues[K]): void {
  load()
  const session = sessionKeyOf(key)
  const project = modThemeProjectKey(key.projectPath)
  const sessionRow = session ? state.session[session] : undefined
  const projectRow = project ? state.project[project] : undefined
  const sessionDone = !session || (!!sessionRow && kind in sessionRow && sessionRow[kind] === null)
  const projectMatches = !!projectRow?.[kind] && fingerprint(kind, projectRow[kind]) === fingerprint(kind, previous)
  if (sessionDone && !projectMatches) return
  clock += 1
  const next: CacheState = { ...state }
  if (session && !sessionDone) next.session = prune({ ...state.session, [session]: { ...sessionRow, [kind]: null, at: clock } }, MAX_SESSIONS)
  if (project && projectMatches && projectRow) {
    const rest: Row = { ...projectRow }
    delete rest[kind]
    const table = { ...state.project }
    if (rest.backdrop || rest.theme) table[project] = rest
    else delete table[project]
    next.project = table
  }
  commit(next)
}

export function resetModThemeCacheForTests(): void {
  state = { session: {}, project: {} }
  loaded = true
  clock = 0
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  for (const listener of listeners) listener()
}
