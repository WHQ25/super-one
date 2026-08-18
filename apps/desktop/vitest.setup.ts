import { vi } from 'vitest'

// Default stubs so files that import electron / @electron-toolkit/utils
// (via harness/home.ts) can load under vitest. Per-file vi.mock() still wins.
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? '/tmp/superone-test-userData' : '/tmp'),
    getVersion: () => '0.0.0-test',
  },
  BrowserWindow: class BrowserWindow {},
  ipcMain: { handle: () => undefined, on: () => undefined, removeHandler: () => undefined },
  session: { defaultSession: {} },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (buf: Buffer) => buf.toString(),
  },
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

// This setup file re-runs in every test file (the forks pool shares no module
// cache), so anything imported here is paid 600+ times. jest-dom's matchers and
// the react-i18next bootstrap — which parses every translation bundle — are only
// reachable from tests that render, so they load lazily under jsdom only.
const isDom = typeof document !== 'undefined'

if (isDom) {
  await import('@testing-library/jest-dom/vitest')

  const [{ default: i18n }, { initReactI18next }, { resources }] = await Promise.all([
    import('i18next'),
    import('react-i18next'),
    import('@superone/shared/i18n'),
  ])

  if (!i18n.isInitialized) {
    await i18n
      .use(initReactI18next)
      .init({
        resources,
        lng: 'en',
        fallbackLng: 'en',
        interpolation: { escapeValue: false },
        returnNull: false,
      })
  }
}

if (typeof (globalThis as unknown as { self?: unknown }).self === 'undefined') {
  Object.defineProperty(globalThis, 'self', { configurable: true, writable: true, value: globalThis })
}

if (typeof globalThis.window !== 'undefined' && !(globalThis.window as unknown as Record<string, unknown>).app) {
  const noop = () => Promise.resolve(undefined)
  const w = globalThis.window as unknown as Record<string, unknown>
  w.app = new Proxy({}, { get: () => noop })
  w.agent = new Proxy({}, { get: () => noop })
  // `window.environment` needs a shape-aware default: `on*` subscriptions hand
  // back a synchronous unsubscribe, while every query resolves to an empty list
  // so components can render their list state without a per-test stub.
  w.environment = new Proxy(
    {},
    {
      get: (_target, prop) =>
        typeof prop === 'string' && prop.startsWith('on')
          ? () => () => {}
          : () => Promise.resolve([]),
    },
  )
}

if (typeof (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: ResizeObserverMock })
}

if (typeof (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver === 'undefined') {
  class IntersectionObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): never[] { return [] }
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, writable: true, value: IntersectionObserverMock })
}

if (typeof (globalThis as unknown as { requestIdleCallback?: unknown }).requestIdleCallback === 'undefined') {
  const ric = (cb: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void): number =>
    setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 0) as unknown as number
  const cic = (id: number): void => clearTimeout(id)
  Object.defineProperty(globalThis, 'requestIdleCallback', { configurable: true, writable: true, value: ric })
  Object.defineProperty(globalThis, 'cancelIdleCallback', { configurable: true, writable: true, value: cic })
}

if (typeof globalThis.Element !== 'undefined' && typeof globalThis.Element.prototype.scrollIntoView !== 'function') {
  Object.defineProperty(globalThis.Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: () => {} })
}

if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.setItem !== 'function') {
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
