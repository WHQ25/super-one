import '@testing-library/jest-dom/vitest'

if (typeof globalThis.window !== 'undefined' && !(globalThis.window as unknown as Record<string, unknown>).app) {
  const noop = () => Promise.resolve(undefined)
  const w = globalThis.window as unknown as Record<string, unknown>
  w.app = new Proxy({}, { get: () => noop })
  w.agent = new Proxy({}, { get: () => noop })
}

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>()
  const localStorage = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorage,
    configurable: true,
    writable: true,
  })
}
