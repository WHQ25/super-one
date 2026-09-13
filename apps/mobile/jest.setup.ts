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
 * Skia and Reanimated both reach tests that mount the composer or the
 * workspace list: Skia ships ESM that jest's CommonJS runtime cannot load, and
 * Reanimated's worklets need a native runtime no test has. The canvas is one
 * particle effect; layout animations become plain Views. Both are stubbed
 * rather than transformed, which would cost every suite for a native runtime
 * no assertion can exercise.
 */
jest.mock('@shopify/react-native-skia', () => ({
  BlendMode: {},
  Canvas: () => null,
  Picture: () => null,
  Skia: { PictureRecorder: class {} },
  useClock: () => ({ value: 0 }),
}))

jest.mock('react-native-reanimated', () => {
  const chain = () => {
    const api: Record<string, () => unknown> = {}
    const self = () => api
    for (const key of ['delay', 'duration', 'easing', 'withInitialValues', 'reduceMotion', 'build']) {
      api[key] = self
    }
    return api
  }
  return {
    __esModule: true,
    default: { View: 'View', Text: 'Text', createAnimatedComponent: (component: unknown) => component },
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withTiming: (to: unknown) => to,
    Easing: { bezier: () => (t: number) => t },
    FadeInDown: chain(),
    FadeOut: chain(),
    LinearTransition: chain(),
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
  }
})

/**
 * The native player has no host-component stand-in. The mock keeps the shape
 * the video body reads — a player whose `status` a test can seed through the
 * source, and a view that renders as a plain `View` carrying the props.
 */
jest.mock('expo-video', () => {
  const React = require('react')
  const { View } = require('react-native')
  const players = new Map<string, { status: string; loop: boolean; play: jest.Mock; addListener: jest.Mock; removeListener: jest.Mock }>()
  return {
    useVideoPlayer: (source: string, setup?: (player: unknown) => void) => {
      let player = players.get(source)
      if (!player) {
        player = {
          status: source.includes('missing') ? 'error' : 'readyToPlay',
          loop: true,
          play: jest.fn(),
          addListener: jest.fn(() => ({ remove: jest.fn() })),
          removeListener: jest.fn(),
        }
        players.set(source, player)
        setup?.(player)
      }
      return player
    },
    VideoView: (props: object) => React.createElement(View, { testID: 'video-view', ...props }),
  }
})

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
