import { jest } from '@jest/globals'

/** MMKV is a Nitro native module with no JS fallback; component tests never
 * exercise persistence, so a memory stub keeps imports resolvable. */
jest.mock('react-native-mmkv', () => {
  const store = new Map<string, string>()
  return {
    MMKV: class {
      getString(key: string) { return store.get(key) }
      set(key: string, value: string) { store.set(key, value) }
      delete(key: string) { store.delete(key) }
      getAllKeys() { return [...store.keys()] }
    },
  }
})
