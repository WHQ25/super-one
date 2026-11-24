export * from './types'
import type {
  ChainSlotEntry,
  HocSlotEntry,
  ResolvedChainEntry,
  ResolvedHocEntry,
  ResolvedListEntry,
  SlotDisposer,
  SlotKind,
  SlotMap,
  SlotPropsOf,
  SlotRegistry,
  SlotScopeHandle,
  SlotScopeMeta,
} from './types'

interface StoredEntry {
  kind: SlotKind
  slot: string
  key?: string
  seq: number
  id: string
  priority: number
  order: number
  when?: (scope: SlotScopeMeta) => boolean
  payload: unknown
}

const NOOP_DISPOSER: SlotDisposer = Object.assign(() => {}, {
  dispose: () => {},
  [Symbol.dispose]: () => {},
})

function makeDisposer(onDispose: () => void): SlotDisposer {
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    onDispose()
  }
  return Object.assign(dispose, {
    dispose,
    [Symbol.dispose]: dispose,
  })
}

const EMPTY_ARRAY: readonly never[] = []

export function createSlotRegistry<M = SlotMap>(): SlotRegistry<M> {
  let nextSeq = 1
  let batchDepth = 0
  const dirtySlots = new Set<string>()
  const entriesBySlot = new Map<string, StoredEntry[]>()
  const slotListeners = new Map<string, Set<() => void>>()
  const globalListeners = new Set<() => void>()
  const slotVersions = new Map<string, number>()

  const singleCache = new Map<string, unknown | null>()
  const listCache = new Map<string, readonly ResolvedListEntry[]>()
  const keyedCache = new Map<string, Map<string, unknown | null>>()
  const keyedKeysCache = new Map<string, readonly string[]>()
  const chainCache = new Map<string, readonly ResolvedChainEntry<any, any>[]>()
  const hocCache = new Map<string, readonly ResolvedHocEntry[]>()

  function invalidateSlot(slot: string) {
    slotVersions.set(slot, (slotVersions.get(slot) ?? 0) + 1)
    singleCache.delete(slot)
    listCache.delete(slot)
    keyedCache.delete(slot)
    keyedKeysCache.delete(slot)
    chainCache.delete(slot)
    hocCache.delete(slot)
  }

  function flushNotifications() {
    if (batchDepth > 0 || dirtySlots.size === 0) return
    const slots = [...dirtySlots]
    dirtySlots.clear()
    for (const slot of slots) {
      const listeners = slotListeners.get(slot)
      if (listeners) {
        for (const listener of [...listeners]) listener()
      }
    }
    for (const listener of [...globalListeners]) listener()
  }

  function notifySlot(slot: string) {
    invalidateSlot(slot)
    dirtySlots.add(slot)
    flushNotifications()
  }

  function runBatched(fn: () => void) {
    batchDepth++
    try {
      fn()
    } finally {
      batchDepth--
      if (batchDepth === 0) flushNotifications()
    }
  }

  function addEntry(
    kind: SlotKind,
    slot: string,
    options: { key?: string; id?: string; priority?: number; order?: number; when?: (scope: SlotScopeMeta) => boolean; payload: unknown },
  ): SlotDisposer {
    const seq = nextSeq++
    const entry: StoredEntry = {
      kind,
      slot,
      key: options.key,
      seq,
      id: options.id ?? `slot-entry-${seq}`,
      priority: options.priority ?? 0,
      order: options.order ?? 0,
      when: options.when,
      payload: options.payload,
    }
    let list = entriesBySlot.get(slot)
    if (!list) {
      list = []
      entriesBySlot.set(slot, list)
    }
    list.push(entry)
    notifySlot(slot)

    return makeDisposer(() => {
      const current = entriesBySlot.get(slot)
      if (!current) return
      const index = current.indexOf(entry)
      if (index === -1) return
      current.splice(index, 1)
      if (current.length === 0) entriesBySlot.delete(slot)
      notifySlot(slot)
    })
  }

  const registry: SlotRegistry<M> = {
    registerSingle(slot, entry) {
      return addEntry('single', slot, {
        id: entry.id,
        priority: entry.priority,
        when: entry.when,
        payload: entry.component,
      })
    },
    registerList(slot, entry) {
      return addEntry('list', slot, {
        id: entry.id,
        order: entry.order,
        when: entry.when,
        payload: entry.component,
      })
    },
    registerKeyed(slot, key, entry) {
      return addEntry('keyed', slot, {
        key,
        id: entry.id,
        priority: entry.priority,
        when: entry.when,
        payload: entry.component,
      })
    },
    registerChain(slot, entry) {
      return addEntry('chain', slot, {
        id: entry.id,
        priority: entry.priority,
        when: entry.when,
        payload: entry,
      })
    },
    registerHoc(slot, entry) {
      return addEntry('hoc', slot, {
        id: entry.id,
        priority: entry.priority,
        when: entry.when,
        payload: entry,
      })
    },

    getSingle(slot, scope) {
      const all = entriesBySlot.get(slot) ?? []
      if (!scope && !all.some((e) => e.when)) {
        if (singleCache.has(slot)) return singleCache.get(slot) ?? null
        const entries = all.filter((e) => e.kind === 'single')
        if (entries.length === 0) {
          singleCache.set(slot, null)
          return null
        }
        entries.sort((a, b) => (b.priority - a.priority) || (b.seq - a.seq))
        const resolved = entries[0].payload
        singleCache.set(slot, resolved)
        return resolved
      }
      const meta = scope ?? {}
      const entries = all.filter((e) => e.kind === 'single' && (!e.when || e.when(meta)))
      if (entries.length === 0) return null
      entries.sort((a, b) => (b.priority - a.priority) || (b.seq - a.seq))
      return entries[0].payload
    },

    getList(slot) {
      const cached = listCache.get(slot)
      if (cached) return cached
      const entries = (entriesBySlot.get(slot) ?? []).filter((e) => e.kind === 'list')
      if (entries.length === 0) {
        listCache.set(slot, EMPTY_ARRAY)
        return EMPTY_ARRAY
      }
      entries.sort((a, b) => (a.order - b.order) || (a.seq - b.seq))
      const resolved: readonly ResolvedListEntry[] = entries.map((e) => ({
        id: e.id,
        order: e.order,
        when: e.when,
        component: e.payload,
      }))
      listCache.set(slot, resolved)
      return resolved
    },

    getKeyed(slot, key, scope) {
      const all = entriesBySlot.get(slot) ?? []
      if (!scope && !all.some((e) => e.when)) {
        let byKey = keyedCache.get(slot)
        if (!byKey) {
          byKey = new Map()
          keyedCache.set(slot, byKey)
        }
        if (byKey.has(key)) return byKey.get(key) ?? null
        const entries = all.filter((e) => e.kind === 'keyed' && e.key === key)
        if (entries.length === 0) {
          byKey.set(key, null)
          return null
        }
        entries.sort((a, b) => (b.priority - a.priority) || (b.seq - a.seq))
        const resolved = entries[0].payload
        byKey.set(key, resolved)
        return resolved
      }
      const meta = scope ?? {}
      const entries = all.filter((e) => e.kind === 'keyed' && e.key === key && (!e.when || e.when(meta)))
      if (entries.length === 0) return null
      entries.sort((a, b) => (b.priority - a.priority) || (b.seq - a.seq))
      return entries[0].payload
    },

    hasKeyed(slot, key) {
      return (entriesBySlot.get(slot) ?? []).some((e) => e.kind === 'keyed' && e.key === key)
    },

    getKeyedKeys(slot) {
      const cached = keyedKeysCache.get(slot)
      if (cached) return cached
      const keys = new Set<string>()
      for (const entry of entriesBySlot.get(slot) ?? []) {
        if (entry.kind === 'keyed' && entry.key !== undefined) keys.add(entry.key)
      }
      const resolved = keys.size === 0 ? EMPTY_ARRAY : [...keys]
      keyedKeysCache.set(slot, resolved)
      return resolved
    },

    getChain(slot) {
      const cached = chainCache.get(slot)
      if (cached) return cached as readonly ResolvedChainEntry<SlotPropsOf<M, typeof slot>>[]
      const entries = (entriesBySlot.get(slot) ?? []).filter((e) => e.kind === 'chain')
      if (entries.length === 0) {
        chainCache.set(slot, EMPTY_ARRAY)
        return EMPTY_ARRAY
      }
      entries.sort((a, b) => (b.priority - a.priority) || (a.seq - b.seq))
      const resolved = entries.map((e) => {
        const raw = e.payload as ChainSlotEntry<any, any>
        return {
          id: e.id,
          priority: e.priority,
          when: e.when,
          match: raw.match,
          render: raw.render,
        }
      })
      chainCache.set(slot, resolved)
      return resolved as readonly ResolvedChainEntry<SlotPropsOf<M, typeof slot>>[]
    },

    getHoc(slot) {
      const cached = hocCache.get(slot)
      if (cached) return cached
      const entries = (entriesBySlot.get(slot) ?? []).filter((e) => e.kind === 'hoc')
      if (entries.length === 0) {
        hocCache.set(slot, EMPTY_ARRAY)
        return EMPTY_ARRAY
      }
      entries.sort((a, b) => (b.priority - a.priority) || (a.seq - b.seq))
      const resolved: readonly ResolvedHocEntry[] = entries.map((e) => {
        const raw = e.payload as HocSlotEntry<any, any>
        return {
          id: e.id,
          priority: e.priority,
          when: e.when,
          filterKey: raw.filterKey,
          wrap: raw.wrap,
        }
      })
      hocCache.set(slot, resolved)
      return resolved
    },

    createScope() {
      return createScopeHandle(undefined)
    },

    subscribeSlot(slot, listener) {
      let listeners = slotListeners.get(slot)
      if (!listeners) {
        listeners = new Set()
        slotListeners.set(slot, listeners)
      }
      listeners.add(listener)
      return () => {
        listeners?.delete(listener)
        if (listeners && listeners.size === 0) slotListeners.delete(slot)
      }
    },

    subscribe(listener) {
      globalListeners.add(listener)
      return () => {
        globalListeners.delete(listener)
      }
    },

    getSlotVersion(slot) {
      return slotVersions.get(slot) ?? 0
    },
  }

  function createScopeHandle(onParentDispose?: (fn: () => void) => void): SlotScopeHandle {
    let disposed = false
    const cleanups: (() => void)[] = []

    const track = (disposer: SlotDisposer): SlotDisposer => {
      if (disposed) {
        disposer.dispose()
        return disposer
      }
      cleanups.push(disposer.dispose)
      return disposer
    }

    const dispose = () => {
      if (disposed) return
      disposed = true
      const toRun = cleanups.splice(0, cleanups.length).reverse()
      runBatched(() => {
        for (const fn of toRun) {
          try {
            fn()
          } catch (error) {
            console.error('[ui-slots] disposer failed:', error)
          }
        }
      })
    }

    if (onParentDispose) onParentDispose(dispose)

    return {
      registerSingle(slot, entry) {
        if (disposed) return NOOP_DISPOSER
        return track(registry.registerSingle(slot as never, entry as never))
      },
      registerList(slot, entry) {
        if (disposed) return NOOP_DISPOSER
        return track(registry.registerList(slot as never, entry as never))
      },
      registerKeyed(slot, key, entry) {
        if (disposed) return NOOP_DISPOSER
        return track(registry.registerKeyed(slot as never, key as never, entry as never))
      },
      registerChain(slot, entry) {
        if (disposed) return NOOP_DISPOSER
        return track(registry.registerChain(slot as never, entry as never))
      },
      registerHoc(slot, entry) {
        if (disposed) return NOOP_DISPOSER
        return track(registry.registerHoc(slot as never, entry as never))
      },
      createScope() {
        if (disposed) {
          const empty = createScopeHandle()
          empty.dispose()
          return empty
        }
        return createScopeHandle((childDispose) => {
          cleanups.push(childDispose)
        })
      },
      onDispose(fn) {
        return track(makeDisposer(fn))
      },
      dispose,
      [Symbol.dispose]: dispose,
    }
  }

  return registry
}
