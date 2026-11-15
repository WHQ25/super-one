import type { ModBackdropSnapshot, ModThemeScope } from '@superone/chat-view/mod-ui'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'

/**
 * A mod theme stored at one apply scope.
 * `cleared` is an explicit opt-out: it blocks every wider scope.
 * A missing slot does not block wider scopes.
 */
interface ThemeSlot {
  backdrop: ModBackdropSnapshot | null
  themeProps: Record<string, unknown> | null
  cleared?: boolean
}

interface ThemeCacheState {
  session: Record<string, ThemeSlot>
  folder: Record<string, ThemeSlot>
  project: Record<string, ThemeSlot>
  harness: ThemeSlot | null
}

export interface ModThemeQuery {
  sessionId?: string | null
  folderPath?: string | null
  projectPath?: string | null
}

export interface ResolvedModTheme {
  backdrop: ModBackdropSnapshot | null
  themeProps: Record<string, unknown> | null
  scope: ModThemeScope | null
}

const STORAGE_KEY = 'superone:mod-theme-cache:v2'
const EMPTY_RESOLVED: ResolvedModTheme = { backdrop: null, themeProps: null, scope: null }

let state: ThemeCacheState = emptyState()
let loaded = false
const listeners = new Set<() => void>()

function emptyState(): ThemeCacheState {
  return { session: {}, folder: {}, project: {}, harness: null }
}

function emptySlot(): ThemeSlot {
  return { backdrop: null, themeProps: null }
}

function normalizePath(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  return trimmed || path.trim()
}

function hostPrefix(projectPath: string | null | undefined): string {
  if (!projectPath) return 'local'
  return parseRemoteProjectKey(projectPath)?.connectionId ?? 'local'
}

/** Folder identity. A subdirectory is a different folder from its parent. */
export function modThemeFolderKey(projectPath: string | null | undefined, folderPath: string | null | undefined): string | null {
  if (!folderPath?.trim()) return null
  return `${hostPrefix(projectPath)}\0${normalizePath(folderPath)}`
}

export function modThemeProjectKey(projectPath: string | null | undefined): string | null {
  if (!projectPath?.trim()) return null
  const remote = parseRemoteProjectKey(projectPath)
  const path = remote ? remote.path : projectPath
  return `${hostPrefix(projectPath)}\0${normalizePath(path)}`
}

function loadFromStorage(): void {
  if (loaded || typeof localStorage === 'undefined') return
  loaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Partial<ThemeCacheState>
    state = {
      session: parsed.session && typeof parsed.session === 'object' ? parsed.session : {},
      folder: parsed.folder && typeof parsed.folder === 'object' ? parsed.folder : {},
      project: parsed.project && typeof parsed.project === 'object' ? parsed.project : {},
      harness: parsed.harness && typeof parsed.harness === 'object' ? parsed.harness : null,
    }
  } catch {
    state = emptyState()
  }
}

function saveToStorage(): void {
  if (typeof localStorage === 'undefined') return
  try {
    const harness = state.harness && (state.harness.backdrop || state.harness.themeProps || state.harness.cleared) ? state.harness : null
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, harness }))
  } catch {
    // A full disk must not break the live pane.
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeModThemeCache(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getModThemeCache(): ThemeCacheState {
  loadFromStorage()
  return state
}

function scopeKey(scope: ModThemeScope, query: ModThemeQuery): string | null {
  if (scope === 'harness') return ''
  if (scope === 'session') return query.sessionId?.trim() || null
  if (scope === 'folder') return modThemeFolderKey(query.projectPath, query.folderPath)
  return modThemeProjectKey(query.projectPath)
}

function readSlot(scope: ModThemeScope, key: string): ThemeSlot | null {
  if (scope === 'harness') return state.harness
  return state[scope][key] ?? null
}

function writeSlot(scope: ModThemeScope, key: string, slot: ThemeSlot | null): ThemeCacheState {
  if (scope === 'harness') return { ...state, harness: slot }
  const table = { ...state[scope] }
  if (slot) table[key] = slot
  else delete table[key]
  return { ...state, [scope]: table }
}

function slotKeeps(slot: ThemeSlot): boolean {
  return Boolean(slot.cleared || slot.backdrop || slot.themeProps)
}

/**
 * Store one payload at one scope. A payload with no scope is the caller's
 * job to pass as `session` — this function never copies it to a wider scope.
 * `clear` is an explicit opt-out of that scope and every scope wider than it.
 */
export function writeModTheme(input: ModThemeQuery & {
  scope: ModThemeScope
  backdrop?: ModBackdropSnapshot | null
  themeProps?: Record<string, unknown> | null
  clear?: boolean
}): void {
  loadFromStorage()
  const key = scopeKey(input.scope, input)
  if (key === null) return
  const prev = readSlot(input.scope, key) ?? emptySlot()
  const slot: ThemeSlot = input.clear
    ? { backdrop: null, themeProps: null, cleared: true }
    : {
        backdrop: input.backdrop !== undefined ? input.backdrop : prev.backdrop,
        themeProps: input.themeProps !== undefined ? input.themeProps : prev.themeProps,
      }
  // An empty follow-up write must not erase an explicit opt-out.
  if (!input.clear && !slot.backdrop && !slot.themeProps && prev.cleared) slot.cleared = true
  const next = slotKeeps(slot) ? slot : null
  const stored = readSlot(input.scope, key)
  if (stored === next) return
  if (stored && next && stored.backdrop === next.backdrop && stored.themeProps === next.themeProps && Boolean(stored.cleared) === Boolean(next.cleared)) return
  state = writeSlot(input.scope, key, next)
  saveToStorage()
  emit()
}

/** One theme for Claude. Narrower slots are dropped so they cannot hide it. */
export function setGlobalModTheme(backdrop: ModBackdropSnapshot | null): void {
  loadFromStorage()
  state = {
    session: {},
    folder: {},
    project: {},
    harness: backdrop ? { backdrop, themeProps: null } : null,
  }
  saveToStorage()
  emit()
}

/** session, then folder, then project, then harness. A cleared slot stops the walk. */
export function resolveModTheme(cache: ThemeCacheState, query: ModThemeQuery): ResolvedModTheme {
  const steps: Array<[ModThemeScope, ThemeSlot | null]> = [
    ['session', query.sessionId?.trim() ? cache.session[query.sessionId.trim()] ?? null : null],
    ['folder', (() => {
      const key = modThemeFolderKey(query.projectPath, query.folderPath)
      return key ? cache.folder[key] ?? null : null
    })()],
    ['project', (() => {
      const key = modThemeProjectKey(query.projectPath)
      return key ? cache.project[key] ?? null : null
    })()],
    ['harness', cache.harness],
  ]
  for (const [scope, slot] of steps) {
    if (!slot) continue
    if (slot.cleared) return EMPTY_RESOLVED
    if (slot.backdrop || slot.themeProps) {
      return { backdrop: slot.backdrop, themeProps: slot.themeProps, scope }
    }
  }
  return EMPTY_RESOLVED
}

export function resetModThemeCacheForTests(): void {
  state = emptyState()
  loaded = true
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  emit()
}
