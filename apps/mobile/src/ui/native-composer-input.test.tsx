import { afterEach, expect, jest, test } from '@jest/globals'
import { createRef } from 'react'
import { act, render } from '@testing-library/react-native'
import { NativeComposerInput, type NativeComposerController } from './native-composer-input'
import { parseMentionEditorSnapshot } from '../mention-editor-state'

let mockProps: any
jest.mock('./native-mention-editor', () => ({ NativeMentionEditor: (props: unknown) => { mockProps = props; return null } }))
jest.mock('./mention-dynamic-artwork', () => ({ rememberMentionArtwork: jest.fn() }))
afterEach(() => { jest.useRealTimers() })

async function setup() {
  const controller = createRef<NativeComposerController>()
  const onChange = jest.fn()
  const onError = jest.fn()
  const view = await render(<NativeComposerInput binding={{ controller, document: [], onChange, onError }}
    tablet={false} editable placeholder="Message" onSubmit={() => {}} />)
  const change = async (extra: object = {}) => act(() => mockProps.onChange(parseMentionEditorSnapshot({
    text: '你好', tokens: [], start: 2, end: 2, eventCount: 1, composing: true, supportsPrepareSubmit: true, ...extra,
  })))
  await change()
  return { controller, onChange, onError, change, view }
}

test('a Send tap commits composition and waits for the native draft before sending', async () => {
  const { controller, onChange, change } = await setup()
  expect(controller.current!.canSubmit()).toBe(false)
  let pending!: Promise<void>
  await act(() => { pending = controller.current!.prepareSubmit() })
  const done = jest.fn()
  void pending.then(done)
  expect(mockProps.command.action).toBe('prepareSubmit')
  expect(done).not.toHaveBeenCalled()
  await change({ text: '你好世界', end: 4, eventCount: 2, composing: false, submissionId: mockProps.command.id })
  await pending
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ text: '你好世界' }))
  expect(done).toHaveBeenCalledTimes(1)
})

test('waits for an insertion acknowledgement and coalesces repeated taps', async () => {
  const { controller, change } = await setup()
  await change({ composing: false })
  await act(() => { expect(controller.current!.replaceText('draft')).toBe(true) })
  const editId = mockProps.command.id
  let pending!: Promise<void>
  await act(() => {
    pending = controller.current!.prepareSubmit()
    expect(controller.current!.prepareSubmit()).toBe(pending)
  })
  expect(mockProps.command.id).toBe(editId)
  await change({ text: 'draft', end: 5, eventCount: 2, composing: false })
  expect(mockProps.command.action).toBe('prepareSubmit')
  await change({ text: 'draft', end: 5, eventCount: 2, composing: false, submissionId: mockProps.command.id })
  await pending
})

test('a rejected edit does not permanently block sending the authoritative draft', async () => {
  const { controller, change } = await setup()
  await change({ composing: false, rejection: 'stale-or-composing' })
  let pending!: Promise<void>
  await act(() => { pending = controller.current!.prepareSubmit() })
  await change({ composing: false, submissionId: mockProps.command.id })
  await expect(pending).resolves.toBeUndefined()
})

test('a missing native acknowledgement reports failure without clearing text, then permits retry', async () => {
  const { controller, change } = await setup()
  jest.useFakeTimers()
  let pending!: Promise<void>
  await act(() => { pending = controller.current!.prepareSubmit() })
  const failure = expect(pending).rejects.toThrow('Your draft was not sent')
  await act(() => jest.advanceTimersByTime(3000))
  await failure
  expect(mockProps.command.text).toBe('')
  expect(mockProps.command.action).toBe('prepareSubmit') // A read/commit, not a replacement.
  await act(() => { pending = controller.current!.prepareSubmit() })
  await change({ composing: false, submissionId: mockProps.command.id })
  await pending
})

test('older native clients keep sending settled text without receiving unknown commands', async () => {
  const { controller, change } = await setup()
  await change({ supportsPrepareSubmit: false, composing: false })
  await expect(controller.current!.prepareSubmit()).resolves.toBeUndefined()
  expect(mockProps.command.id).toBe(0)
  await change({ supportsPrepareSubmit: false, composing: true })
  await expect(controller.current!.prepareSubmit()).resolves.toBeUndefined()
  expect(mockProps.command.action).toBeUndefined()
})

test('a prepareSubmit acknowledgement still sends when the IME re-marks the draft', async () => {
  const { controller, change } = await setup()
  let pending!: Promise<void>
  await act(() => { pending = controller.current!.prepareSubmit() })
  await change({ text: '你好世界', end: 4, eventCount: 2, composing: true, submissionId: mockProps.command.id })
  await pending
})

test('does not replace the native draft while composition is still marked', async () => {
  const { controller, change } = await setup()
  await change({ composing: true })
  expect(controller.current!.replaceText('')).toBe(false)
  await change({ composing: false })
  await act(() => { expect(controller.current!.replaceText('')).toBe(true) })
  expect(mockProps.command).toEqual(expect.objectContaining({ text: '', start: 0, end: 2 }))
})
