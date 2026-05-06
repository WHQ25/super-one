import type { HLToken } from './diff-utils'

const MAX_ENTRIES_PER_PROJECT = 100

class HighlightCache {
  private map = new Map<string, HLToken[][]>()

  get(key: string): HLToken[][] | undefined {
    const v = this.map.get(key)
    if (v) {
      this.map.delete(key)
      this.map.set(key, v)
    }
    return v
  }

  set(key: string, value: HLToken[][]): void {
    if (this.map.has(key)) {
      this.map.delete(key)
    } else if (this.map.size >= MAX_ENTRIES_PER_PROJECT) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
    this.map.set(key, value)
  }

  clear(): void {
    this.map.clear()
  }

  get size(): number {
    return this.map.size
  }
}

const caches = new Map<string, HighlightCache>()

export function getHighlightCache(projectPath: string | null | undefined): HighlightCache | null {
  if (!projectPath) return null
  let cache = caches.get(projectPath)
  if (!cache) {
    cache = new HighlightCache()
    caches.set(projectPath, cache)
  }
  return cache
}

export function disposeHighlightCache(projectPath: string): void {
  caches.get(projectPath)?.clear()
  caches.delete(projectPath)
}

export function buildHighlightKey(theme: string, lang: string, code: string): string {
  let h = 2166136261
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `${theme}:${lang}:${code.length}:${(h >>> 0).toString(36)}`
}

export type { HighlightCache }
