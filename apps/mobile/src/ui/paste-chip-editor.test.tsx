import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { PasteChipEditor } from './paste-chip-editor'
import * as Clipboard from 'expo-clipboard'
import { PASTE_TEXT_DIALOG, PASTE_TEXT_EDITOR } from '@superone/ui/lib/paste-chip-presentation'

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => {}) }))

test('edits and copies the full paste, and closes only after native save acknowledgement', async () => {
  let complete!: (ok: boolean) => void
  const onApply = jest.fn((_text: string, _expand: boolean) => new Promise<boolean>(resolve => { complete = resolve }))
  const onClose = jest.fn()
  await renderWithTheme(<PasteChipEditor text={'original\ntext'} onApply={onApply} onClose={onClose} />)
  await act(async () => { fireEvent.changeText(screen.getByLabelText('Pasted Text'), 'edited\ntext') })
  await act(async () => { fireEvent.press(screen.getByLabelText('Copy')) })
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('edited\ntext')
  await act(async () => { fireEvent.press(screen.getByLabelText('Save')) })
  expect(onApply).toHaveBeenCalledWith('edited\ntext', false)
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Save')).toBeDisabled()
  await act(async () => { complete(true) })
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('keeps edited content on rejection and lets the user retry', async () => {
  const onApply = jest.fn(async () => false)
  const onClose = jest.fn()
  await renderWithTheme(<PasteChipEditor text="full paste" onApply={onApply} onClose={onClose} />)
  await act(async () => { fireEvent.changeText(screen.getByLabelText('Pasted Text'), 'keep this edit') })
  await act(async () => { fireEvent.press(screen.getByLabelText('Save')) })
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save pasted text. Please try again.')
  expect(screen.getByLabelText('Pasted Text').props.value).toBe('keep this edit')
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => { fireEvent.press(screen.getByLabelText('Expand to Plain Text')) })
  expect(onApply).toHaveBeenLastCalledWith('keep this edit', true)
})

test('translates the editable paste controls', async () => {
  await renderWithTheme(<PasteChipEditor text="粘贴的全文" onApply={async () => true} onClose={() => {}} />, 'dark', 'zh')
  expect(screen.getByLabelText('粘贴的文本')).toBeTruthy()
  expect(screen.getByLabelText('保存')).toBeTruthy()
  expect(screen.getByLabelText('展开为纯文本')).toBeTruthy()
  expect(screen.getByRole('header')).toHaveTextContent('已粘贴文本 · 1 行')
})

test('uses the desktop text window header and unframed editor, and only saves dirty text', async () => {
  const onApply = jest.fn(async () => true)
  const onClose = jest.fn()
  await renderWithTheme(<PasteChipEditor text="one line" onApply={onApply} onClose={onClose} />)
  expect(screen.getByTestId('paste-text-header')).toHaveStyle({
    paddingHorizontal: PASTE_TEXT_DIALOG.headerPaddingHorizontal,
    paddingVertical: PASTE_TEXT_DIALOG.headerPaddingVertical, borderBottomWidth: 1,
  })
  expect(screen.getByLabelText('Pasted Text')).toHaveStyle({ ...PASTE_TEXT_EDITOR, borderWidth: 0, backgroundColor: 'transparent' })
  expect(screen.getByLabelText('Save')).toBeDisabled()
  await act(async () => { fireEvent.changeText(screen.getByLabelText('Pasted Text'), 'one\ntwo') })
  expect(screen.getByRole('header')).toHaveTextContent('Pasted text · 2 lines  (unsaved)')
  expect(screen.getByLabelText('Save')).not.toBeDisabled()
  await act(async () => { fireEvent.press(screen.getByLabelText('Close')) })
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(onApply).not.toHaveBeenCalled()
})
