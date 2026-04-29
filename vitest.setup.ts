import '@testing-library/jest-dom/vitest'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from './src/shared/i18n'

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

if (typeof globalThis.window !== 'undefined' && !(globalThis.window as unknown as Record<string, unknown>).app) {
  const noop = () => Promise.resolve(undefined)
  const w = globalThis.window as unknown as Record<string, unknown>
  w.app = new Proxy({}, { get: () => noop })
  w.agent = new Proxy({}, { get: () => noop })
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
