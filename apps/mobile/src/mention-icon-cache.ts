/**
 * Icon bytes this device already has, kept between searches and between runs.
 *
 * The host used to inline every app icon in every `search_mentions` answer, so
 * a phone re-received up to two dozen PNGs on each keystroke — over the relay,
 * encrypted, for artwork that had not changed in months. Now the answer carries
 * content ids and this holds the bytes.
 *
 * Ids are content hashes, so an entry is valid until the app changes its own
 * artwork; there is nothing to invalidate and no staleness to reason about.
 */
export const MENTION_ICON_CACHE_KEY = 'mention.icons.v1'

/** Enough for a large Applications folder, small enough to stay a rounding error. */
export const MAX_CACHED_ICONS = 200

export interface MentionIconStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

type Entries = Record<string, string>

function parseEntries(raw: string | null): Entries {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const entries: Entries = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value) entries[id] = value
    }
    return entries
  } catch {
    // A corrupt cache is not worth a failure: the icons refetch.
    return {}
  }
}

/**
 * Insertion order is the eviction order, so the ids a search just used survive
 * a run of misses.
 */
function evict(entries: Entries): Entries {
  const ids = Object.keys(entries)
  if (ids.length <= MAX_CACHED_ICONS) return entries
  const kept: Entries = {}
  for (const id of ids.slice(ids.length - MAX_CACHED_ICONS)) kept[id] = entries[id]!
  return kept
}

export class MentionIconCache {
  private entries: Entries = {}
  private loaded: Promise<void> | null = null
  private dirty = false
  private writing: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly store: MentionIconStore) {}

  /** Read the persisted set once; every later lookup is synchronous. */
  load(): Promise<void> {
    this.loaded ??= this.store.get(MENTION_ICON_CACHE_KEY)
      .then((raw) => { this.entries = { ...parseEntries(raw), ...this.entries } })
      .catch(() => { /* An unreadable cache behaves as an empty one. */ })
    return this.loaded
  }

  get(id: string): string | undefined {
    return this.entries[id]
  }

  /** Which of these the device has never seen — the only ids worth fetching. */
  missing(ids: readonly string[]): string[] {
    const wanted = new Set<string>()
    for (const id of ids) if (id && !this.entries[id]) wanted.add(id)
    return [...wanted]
  }

  put(icons: Record<string, string>): boolean {
    let added = false
    for (const [id, value] of Object.entries(icons)) {
      if (!id || !value || this.entries[id]) continue
      this.entries[id] = value
      added = true
    }
    if (added) {
      this.entries = evict(this.entries)
      this.schedulePersist()
    }
    return added
  }

  /**
   * Persisting is deferred and coalesced: a burst of misses while the user
   * types should cost one write, not one per icon.
   */
  private schedulePersist(): void {
    this.dirty = true
    if (this.writing) return
    this.writing = setTimeout(() => {
      this.writing = undefined
      if (!this.dirty) return
      this.dirty = false
      void this.store.set(MENTION_ICON_CACHE_KEY, JSON.stringify(this.entries)).catch(() => {
        // Losing the write only costs a refetch next launch.
      })
    }, 1000)
  }

  /** Flush now, for teardown and for tests that cannot wait a second. */
  async flush(): Promise<void> {
    if (this.writing) { clearTimeout(this.writing); this.writing = undefined }
    if (!this.dirty) return
    this.dirty = false
    await this.store.set(MENTION_ICON_CACHE_KEY, JSON.stringify(this.entries)).catch(() => {})
  }
}
