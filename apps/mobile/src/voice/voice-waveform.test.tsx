import type { ReactNode } from 'react'
import { expect, it, jest } from '@jest/globals'
import { act, fireEvent, render } from '@testing-library/react-native'
import { ULTRATHINK_SHIMMER_COLORS } from '@superone/shared/composer-mode'
import { renderWithTheme } from '../test-render'
import { VoiceAudioLevelStore } from './voice-audio-levels'
import { VoiceWaveform } from './voice-waveform'

let mockCanvasChildren: ReactNode
const mockClock = { value: 800 }
let mockMoving = true

jest.mock('../ui/use-icon-motion', () => ({ useIconMotion: () => mockMoving }))
jest.mock('react-native-reanimated', () => ({
  useSharedValue: (initial: number) => require('react').useRef({ value: initial }).current,
  useDerivedValue: (read: () => unknown) => ({ get value() { return read() } }),
  withTiming: (value: number) => value,
}))
jest.mock('@shopify/react-native-skia', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    // Skia renders these children in its own root, without RN theme context.
    Canvas: ({ children }: { children: ReactNode }) => { mockCanvasChildren = children; return null },
    Path: (props: object) => React.createElement(View, { ...props, testID: 'wave-path' }),
    LinearGradient: (props: object) => React.createElement(View, { ...props, testID: 'wave-gradient' }),
    BlurMask: () => null,
    useClock: () => mockClock,
    vec: (x: number, y: number) => ({ x, y }),
    Skia: { PathBuilder: { Make: () => ({
      points: [] as number[][],
      moveTo(x: number, y: number) { this.points.push([x, y]); return this },
      lineTo(x: number, y: number) { this.points.push([x, y]); return this },
      build() { return this },
    }) } },
  }
})

it.each([
  { scheme: 'light', compact: false }, { scheme: 'dark', compact: false },
  { scheme: 'light', compact: true }, { scheme: 'dark', compact: true },
] as const)('draws $scheme waves (compact: $compact) in a separate canvas root and follows live audio', async ({ scheme, compact }) => {
  mockMoving = scheme === 'dark'
  mockClock.value = 800
  const levels = new VoiceAudioLevelStore()
  levels.publish({ input: 0.11, output: 0 })
  const shell = await renderWithTheme(<VoiceWaveform levels={levels} compact={compact} />, scheme)
  await act(async () => {
    fireEvent(shell.getByTestId('mobile-voice-waveform'), 'layout', { nativeEvent: { layout: { width: compact ? 32 : 260 } } })
  })
  // Mount the actual drawing subtree without MobileThemeProvider, as Skia does.
  const canvas = await render(<>{mockCanvasChildren}</>)
  expect(canvas.getAllByTestId('wave-path')).toHaveLength(9)
  const main = canvas.getAllByTestId('wave-path')[7]!
  const points = () => main.props.path.value.points as number[][]
  expect(points().some(([, y]) => y !== 18)).toBe(true)
  const before = points()
  mockClock.value = 1600
  expect(points()).toEqual(mockMoving ? expect.not.arrayContaining(before) : before)
  const gradient = canvas.getAllByTestId('wave-gradient').at(-1)!
  expect(gradient.props.colors.value[0]).toMatch(`rgba(${ULTRATHINK_SHIMMER_COLORS[scheme][0]!.join(',')},`)
  await act(async () => { levels.publish({ input: 0, output: 0.14 }) })
  expect(points().some(([, y]) => y !== 18)).toBe(true)
  await act(async () => { levels.publish({ input: 0, output: 0 }) })
  expect(points().every(([, y]) => y === 18)).toBe(true)
  expect(canvas.getAllByTestId('wave-path')[8]!.props.opacity.value).toBe(0)
  await shell.unmount()
  await canvas.unmount()
})
