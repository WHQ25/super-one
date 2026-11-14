import type { ModBackdropSnapshot } from '@superone/chat-view/mod-ui'

interface CachedProjectTheme {
  backdrop?: ModBackdropSnapshot | null
  themeProps?: Record<string, unknown> | null
}

const STORAGE_KEY = 'superone:mod-theme-cache:v1'
const memoryCache = new Map<string, CachedProjectTheme>()
let loaded = false

function loadFromStorage(): void {
  if (loaded || typeof localStorage === 'undefined') return
  loaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, CachedProjectTheme>
    if (!parsed || typeof parsed !== 'object') return
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v === 'object') memoryCache.set(k, v)
    }
  } catch {
  }
}

function saveToStorage(): void {
  if (typeof localStorage === 'undefined') return
  try {
    const out: Record<string, CachedProjectTheme> = {}
    for (const [k, v] of memoryCache.entries()) {
      if (v.backdrop || v.themeProps) out[k] = v
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out))
  } catch {
  }
}

export function readCachedProjectTheme(projectPath: string | null | undefined): CachedProjectTheme {
  if (!projectPath) return {}
  loadFromStorage()
  return memoryCache.get(projectPath) ?? {}
}

export function writeCachedProjectBackdrop(projectPath: string | null | undefined, backdrop: ModBackdropSnapshot | null): void {
  if (!projectPath) return
  loadFromStorage()
  const prev = memoryCache.get(projectPath) ?? {}
  if (prev.backdrop === backdrop) return
  memoryCache.set(projectPath, { ...prev, backdrop })
  saveToStorage()
}

export function writeCachedProjectThemeProps(projectPath: string | null | undefined, themeProps: Record<string, unknown> | null): void {
  if (!projectPath) return
  loadFromStorage()
  const prev = memoryCache.get(projectPath) ?? {}
  if (prev.themeProps === themeProps) return
  memoryCache.set(projectPath, { ...prev, themeProps })
  saveToStorage()
}
