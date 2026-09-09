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

/**
 * Skia and Reanimated both reach every test that mounts the composer
 * (`ModelPicker` → the `max` effort easter egg): Skia ships ESM that jest's
 * CommonJS runtime cannot load, and Reanimated's worklets need a native runtime
 * no test has. Nothing under test draws with either — the canvas is one
 * particle effect — so both are stubbed rather than transformed, which would
 * cost every suite for a component no assertion touches.
 */
jest.mock('@shopify/react-native-skia', () => ({
  BlendMode: {},
  Canvas: () => null,
  Picture: () => null,
  Skia: { PictureRecorder: class {} },
  useClock: () => ({ value: 0 }),
}))

jest.mock('react-native-reanimated', () => ({
  useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
  useSharedValue: (initial: unknown) => ({ value: initial }),
}))

/** The title's temporary WebView is driven through its native message callbacks
 * in component tests; its actual CSS/JS is exercised in browser integration tests. */
jest.mock('react-native-webview', () => {
  const React = require('react')
  const { View } = require('react-native')
  return { WebView: React.forwardRef((props: object, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ injectJavaScript: jest.fn() }))
    return React.createElement(View, props)
  }) }
})
