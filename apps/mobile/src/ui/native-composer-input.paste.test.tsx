import { createRef, type ComponentProps } from 'react'
import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { MobileThemeProvider } from '../theme/context'
import { NativeComposerInput, type NativeComposerController } from './native-composer-input'
import type { NativeMentionEditor } from './native-mention-editor'
import { parseMentionEditorSnapshot } from '../mention-editor-state'

let mockNativeProps: ComponentProps<typeof NativeMentionEditor>
jest.mock('./native-mention-editor', () => ({
  NativeMentionEditor: (props: ComponentProps<typeof NativeMentionEditor>) => {
    mockNativeProps = props
    return require('react').createElement(require('react-native').View, { testID: 'native-editor' })
  },
}))
jest.mock('./menu-host', () => {
  const actual = jest.requireActual<typeof import('./menu-host')>('./menu-host')
  return { ...actual, useMenuHost: () => {
    const host = actual.useMenuHost()
    return require('react').useMemo(() => ({ ...host,
      measure: (_ref: unknown, done: (rect: object) => void) => done({ x: 10, y: 500, width: 360, height: 60 }),
    }), [host])
  } }
})

const snapshot = (text = 'original', eventCount = 1, rejection?: string) => parseMentionEditorSnapshot({
  text: '\uFFFC', start: 1, end: 1, tokens: [{ offset: 0, kind: 'paste', value: text, displayName: text }], eventCount, composing: false, rejection,
})
async function open() {
  const onChange = jest.fn()
  await render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
    <MobileThemeProvider colorScheme="dark" locale="en">
      <NativeComposerInput binding={{ controller: createRef<NativeComposerController>(), document: [{ paste: 'original' }], onChange, onError: () => {} }}
        tablet={false} editable placeholder="Message" onSubmit={() => {}} />
    </MobileThemeProvider>
  </SafeAreaProvider>)
  await act(async () => { mockNativeProps.onChange(snapshot()) })
  await act(async () => { mockNativeProps.onMentionPress?.({ kind: 'paste', value: 'original', offset: 0, frame: { x: 5, y: 5, width: 100, height: 22 } }) })
  return onChange
}

test('keeps the editor draft until native acknowledges the exact chip edit', async () => {
  const onChange = await open()
  await act(async () => { fireEvent.changeText(screen.getByLabelText('Pasted Text'), 'edited') })
  await act(async () => { fireEvent.press(screen.getByLabelText('Save')) })
  expect(mockNativeProps.command).toMatchObject({ eventCount: 1, start: 0, end: 1, text: '\uFFFC', tokens: [{ kind: 'paste', value: 'edited' }] })
  expect(screen.getByLabelText('Save')).toBeDisabled()
  await act(async () => { mockNativeProps.onChange(snapshot('edited', 2)) })
  expect(screen.queryByLabelText('Pasted Text')).toBeNull()
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ document: [{ paste: 'edited' }] }))
})

test('native rejection leaves the edited paste visible and sendable draft unchanged', async () => {
  const onChange = await open()
  await act(async () => { fireEvent.changeText(screen.getByLabelText('Pasted Text'), 'keep me') })
  await act(async () => { fireEvent.press(screen.getByLabelText('Save')) })
  await act(async () => { mockNativeProps.onChange(snapshot('original', 1, 'stale-or-composing')) })
  expect(screen.getByLabelText('Pasted Text').props.value).toBe('keep me')
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ document: [{ paste: 'original' }] }))
  await act(async () => { fireEvent.press(screen.getByLabelText('Save')) })
  expect(screen.getByLabelText('Save')).toBeDisabled()
  await act(async () => { mockNativeProps.onChange(snapshot('keep me', 2)) })
  expect(screen.queryByLabelText('Pasted Text')).toBeNull()
})
