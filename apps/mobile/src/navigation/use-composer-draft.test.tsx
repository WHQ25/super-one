import { expect, jest, test } from '@jest/globals'
import { act, renderHook } from '@testing-library/react-native'
import { useComposerDraft } from './use-composer-draft'
import { parseMentionEditorSnapshot } from '../mention-editor-state'
import type { NativeComposerController } from '../ui/native-composer-input'

function snapshot(extra: object = {}) {
  return parseMentionEditorSnapshot({
    text: '你好', tokens: [], start: 2, end: 2, eventCount: 1, composing: true, ...extra,
  })
}

test('clears the fallback editor after a successful send', async () => {
  const { result } = await renderHook(() => useComposerDraft())
  await act(() => result.current.changeText('hello'))
  const sent = result.current.capture()
  await act(() => { expect(result.current.clearSent(sent.revision)).toBe(true) })
  expect(result.current.draft).toBe('')
  expect(result.current.generation).toBe(0)
})

test('remounts the native editor when composition blocks the replacement', async () => {
  const { result } = await renderHook(() => useComposerDraft())
  await act(() => {
    result.current.editorRef.current = { replaceText: () => false } as NativeComposerController
    result.current.accept(snapshot())
  })
  const sent = result.current.capture()
  await act(() => { expect(result.current.clearSent(sent.revision)).toBe(true) })
  expect(result.current.draft).toBe('')
  expect(result.current.generation).toBe(1)
})

test('still clears after an IME snapshot that did not change the sent text', async () => {
  const { result } = await renderHook(() => useComposerDraft())
  await act(() => {
    result.current.editorRef.current = { replaceText: () => false } as NativeComposerController
    result.current.accept(snapshot())
  })
  const sent = result.current.capture()
  await act(() => { result.current.accept(snapshot({ eventCount: 2, composing: true })) })
  await act(() => { expect(result.current.clearSent(sent.revision)).toBe(true) })
  expect(result.current.draft).toBe('')
  expect(result.current.generation).toBe(1)
})

test('keeps a draft the user edited while the send was in flight', async () => {
  const { result } = await renderHook(() => useComposerDraft())
  const replaceText = jest.fn(() => true)
  await act(() => {
    result.current.editorRef.current = { replaceText } as unknown as NativeComposerController
    result.current.accept(snapshot({ composing: false }))
  })
  const sent = result.current.capture()
  await act(() => { result.current.accept(snapshot({ text: '下一句', end: 3, eventCount: 2, composing: false })) })
  expect(result.current.clearSent(sent.revision)).toBe(false)
  expect(replaceText).not.toHaveBeenCalled()
  expect(result.current.draft).toBe('下一句')
})
