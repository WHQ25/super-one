import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { parseSchemaForm } from '@superone/shared/schema-form'
import { renderWithTheme } from '../test-render'
import { InputRequestComposer } from './InputRequestComposer'

function form(properties: Record<string, unknown> = { notes: { type: 'string', title: 'Notes' } }): PermissionRequest {
  return { requestId: 'form', toolName: 'composer_request', input: {}, allowAlwaysAllow: false, requestKind: 'input_request',
    inputRequest: { title: 'Review notes', origin: { kind: 'agent' }, output: 'caller' },
    schemaForm: parseSchemaForm({ type: 'object', required: ['notes'], properties }, { userResources: true }) }
}

test('free text grows from one row, preserves newlines, and submits only through its button', async () => {
  const onSubmit = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
  await renderWithTheme(<InputRequestComposer request={form()} connected onSubmit={onSubmit} onCancel={async () => {}} />)
  const input = screen.getByTestId('prompt-field-notes')
  expect(input.props.multiline).toBe(true)
  expect(input.props.submitBehavior).toBe('newline')
  expect(input).toHaveStyle({ minHeight: 40, maxHeight: 144 })
  // A fixed height prevents native intrinsic layout from growing with its text.
  expect(StyleSheet.flatten(input.props.style)).not.toHaveProperty('height')
  await act(async () => {
    await fireEvent.changeText(input, 'First\nSecond')
    await fireEvent(input, 'contentSizeChange', { nativeEvent: { contentSize: { width: 280, height: 92 } } })
  })
  expect(screen.getByTestId('prompt-field-notes').props.scrollEnabled).toBe(false)
  await act(async () => { await fireEvent(input, 'contentSizeChange', { nativeEvent: { contentSize: { width: 280, height: 400 } } }) })
  expect(screen.getByTestId('prompt-field-notes').props.scrollEnabled).toBe(true)
  await act(async () => { await fireEvent(input, 'contentSizeChange', { nativeEvent: { contentSize: { width: 280, height: 40 } } }) })
  expect(screen.getByTestId('prompt-field-notes').props.scrollEnabled).toBe(false)
  expect(onSubmit).not.toHaveBeenCalled()
  await act(async () => { await fireEvent.press(screen.getByTestId('prompt-approve')) })
  expect(onSubmit).toHaveBeenCalledWith({ notes: 'First\nSecond' })
})

test('rejects invalid values and prevents duplicate submission while waiting, then permits retry', async () => {
  let reject!: (reason: Error) => void
  const onSubmit = jest.fn<() => Promise<void>>().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail })).mockResolvedValue(undefined)
  await renderWithTheme(<InputRequestComposer request={form()} connected onSubmit={onSubmit} onCancel={async () => {}} />)
  await act(async () => { await fireEvent.press(screen.getByTestId('prompt-approve')) })
  expect(screen.getByText('Required')).toBeTruthy()
  expect(onSubmit).not.toHaveBeenCalled()
  await act(async () => { await fireEvent.changeText(screen.getByTestId('prompt-field-notes'), 'draft') })
  await act(async () => {
    await fireEvent.press(screen.getByTestId('prompt-approve'))
    await fireEvent.press(screen.getByTestId('prompt-approve'))
  })
  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('prompt-reject')).toBeDisabled()
  await act(async () => { reject(new Error('Host rejected this value')) })
  expect(screen.getByText('Host rejected this value')).toBeTruthy()
  expect(screen.getByTestId('prompt-field-notes').props.value).toBe('draft')
  await act(async () => { await fireEvent.press(screen.getByTestId('prompt-approve')) })
  expect(onSubmit).toHaveBeenCalledTimes(2)
})

test('restores a draft after preemption and keeps the form disabled while disconnected', async () => {
  const draft = { values: { notes: 'Preserved\nnotes' }, stepIndex: 0, touched: new Set(['notes']), resources: new Map() }
  const onCancel = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
  await renderWithTheme(<InputRequestComposer request={form()} connected={false} draft={draft} onSubmit={async () => {}} onCancel={onCancel} />, 'light', 'zh')
  expect(screen.getByTestId('prompt-field-notes').props.value).toBe('Preserved\nnotes')
  expect(screen.getByTestId('prompt-approve')).toBeDisabled()
  expect(screen.getByTestId('prompt-reject')).toBeDisabled()
  expect(screen.queryByTestId('prompt-feedback')).toBeNull()
})

test('upload failure stays in the form and can be retried without a permission sheet', async () => {
  const request = form({ notes: { type: 'string', default: 'ready' }, files: { type: 'array', items: { type: 'string', format: 'uri' }, 'x-openai-input': { type: 'file', options: [], userOptions: { kind: 'file' } } } })
  const pick = jest.fn<(field: string) => Promise<Array<{ uri: string; name: string }>>>().mockRejectedValueOnce(new Error('Upload failed')).mockResolvedValue([{ uri: 'file:///chosen', name: 'chosen.stl' }])
  await renderWithTheme(<InputRequestComposer request={request} connected onSubmit={async () => {}} onCancel={async () => {}} onPickFiles={pick} />)
  await act(async () => { await fireEvent.press(screen.getByTestId('prompt-approve')) })
  await act(async () => { await fireEvent.press(screen.getByTestId('prompt-pick-files')) })
  expect(screen.getByText('Upload failed')).toBeTruthy()
  await act(async () => { await fireEvent.press(screen.getByTestId('prompt-pick-files')) })
  expect(screen.getByText('chosen.stl')).toBeTruthy()
  expect(screen.getByTestId('prompt-option-file:///chosen')).toBeChecked()
})

test('a directory field explains the phone boundary and offers cancellation', async () => {
  const request = { ...form(), schemaForm: parseSchemaForm({ type: 'object', properties: { directory: {
    type: 'string', 'x-openai-input': { type: 'file', options: [], userOptions: { kind: 'directory' } },
  } } }, { userResources: true }) }
  const onCancel = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
  await renderWithTheme(<InputRequestComposer request={request} connected onSubmit={async () => {}} onCancel={onCancel} />)
  expect(screen.getByText('This form cannot be completed on this phone.')).toBeTruthy()
  expect(screen.queryByTestId('prompt-approve')).toBeNull()
  await act(async () => { await fireEvent.press(screen.getByLabelText('Cancel')) })
  expect(onCancel).toHaveBeenCalledTimes(1)
})
