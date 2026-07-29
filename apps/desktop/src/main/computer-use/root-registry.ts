import type { UiRootIdentity } from './types'

/**
 * Session-local registry of UI roots (`@rN`).
 * Roots are re-listed from the platform adapter; this map is the public identity layer.
 */
export class RootRegistry {
  private readonly roots = new Map<string, UiRootIdentity>()
  private seq = 0

  clear(): void {
    this.roots.clear()
    this.seq = 0
  }

  get(rootId: string): UiRootIdentity | undefined {
    return this.roots.get(rootId)
  }

  list(): UiRootIdentity[] {
    return [...this.roots.values()]
  }

  /**
   * Upsert roots from a platform scan. Reuses existing rootIds when the same
   * native identity (resourceKey + title + kind) matches; otherwise allocates `@rN`.
   */
  sync(discovered: Omit<UiRootIdentity, 'rootId'>[]): UiRootIdentity[] {
    const next = new Map<string, UiRootIdentity>()
    const used = new Set<string>()

    for (const d of discovered) {
      const key = identityKey(d)
      const existing = [...this.roots.values()].find(
        (r) => identityKey(r) === key && !used.has(r.rootId),
      )
      const rootId = existing?.rootId ?? this.alloc()
      used.add(rootId)
      const identity: UiRootIdentity = { ...d, rootId }
      next.set(rootId, identity)
    }

    this.roots.clear()
    for (const [id, r] of next) this.roots.set(id, r)
    return this.list()
  }

  /** Force-register a single root (tests / fake backend bootstrap). */
  register(root: UiRootIdentity): void {
    this.roots.set(root.rootId, root)
    const n = parseRootSeq(root.rootId)
    if (n >= this.seq) this.seq = n
  }

  private alloc(): string {
    this.seq += 1
    return `@r${this.seq}`
  }
}

function identityKey(r: Pick<UiRootIdentity, 'resourceKey' | 'title' | 'kind' | 'pid'>): string {
  return `${r.resourceKey}|${r.kind}|${r.pid}|${r.title}`
}

function parseRootSeq(rootId: string): number {
  const m = /^@r(\d+)$/.exec(rootId)
  return m ? Number(m[1]) : 0
}
