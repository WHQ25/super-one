/** @vitest-environment jsdom */
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { MediaComposerResult } from '@superone/shared/media-composer'
import { PNG_ATTACHMENT } from '@superone/shared/test-fixtures/attachments'
import { useChatStore } from '@/stores/chat'
import { composerStackFor, topComposer } from '../composer-slot/composer-stack'
import { useMediaRuns } from './media-composer-runs'
import { api, imageResult, openComposer, openWithoutWaiting, owner, setDecision, useMediaComposerHarness } from './media-composer-test-harness'

useMediaComposerHarness()

it('starts at one row and uses Shift+Enter and Alt+Enter to insert newlines without generating', async () => {
  await openComposer()
  const field = screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement
  expect(field.rows).toBe(1)
  field.focus(); field.setSelectionRange(field.value.length, field.value.length)
  fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
  expect(field.value).toBe('A mountain\n')
  fireEvent.keyDown(field, { key: 'Enter', altKey: true })
  expect(field.value).toBe('A mountain\n\n')
  expect(api.mediaGenerate).not.toHaveBeenCalled()
})

it('generates with the displayed model and retains the result and prompt through approval preemption', async () => {
  let resolve!: (result: MediaComposerResult) => void
  api.mediaGenerate.mockImplementation(() => new Promise(done => { resolve = done }))
  await openComposer()
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  expect(api.mediaGenerate).toHaveBeenCalledWith(expect.objectContaining({ ...owner, providerId: 'key', model: 'image-model', prompt: 'A mountain' }))
  setDecision(true)
  expect(screen.getByText('Decision owns the slot')).toBeInTheDocument()
  await act(async () => resolve(imageResult))
  expect(api.mediaCancel).not.toHaveBeenCalled()
  setDecision(false)
  expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('A mountain')
  expect(screen.getByRole('button', { name: 'Insert into Draft' })).toBeEnabled()
  expect(api.mediaGenerate).toHaveBeenCalledTimes(1)
})

it('cancels when the mode chip exits and ignores a late provider result', async () => {
  let resolve!: (result: MediaComposerResult) => void
  api.mediaGenerate.mockImplementation(() => new Promise(done => { resolve = done }))
  await openComposer()
  const entry = topComposer(owner)!
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  fireEvent.click(screen.getByTitle('Exit Image Generation'))
  expect(api.mediaCancel).toHaveBeenCalledWith(expect.any(String))
  await act(async () => resolve(imageResult))
  expect(useMediaRuns.getState().runs[entry.key]).toBeUndefined()
  expect(composerStackFor(owner).base).toBeNull()
})

it('stops an in-flight image from the stop button without leaving the mode', async () => {
  api.mediaGenerate.mockImplementation(() => new Promise(() => {}))
  await openComposer()
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Generation' }))
  expect(api.mediaCancel).toHaveBeenCalledWith(expect.any(String))
  expect(composerStackFor(owner).base).not.toBeNull()
})

it('shows actionable provider setup when no media model is enabled', async () => {
  api.mediaModels.mockResolvedValue([])
  await openWithoutWaiting('image')
  expect(await screen.findByRole('button', { name: 'Open Providers' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
})

it('adds dropped reference images and rejects unsupported files', async () => {
  await openComposer()
  const box = screen.getByRole('textbox', { name: 'Prompt' }).parentElement!
  const png = new File([Uint8Array.from(atob(PNG_ATTACHMENT.base64), c => c.charCodeAt(0))], 'ref.png', { type: 'image/png' })
  fireEvent.drop(box, { dataTransfer: { types: ['Files'], files: [png] } })
  expect(await screen.findByRole('img', { name: 'ref.png' })).toBeInTheDocument()
  fireEvent.drop(box, { dataTransfer: { types: ['Files'], files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } })
  await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1))
})

it('asks the agent instead of generating, leaving the chat draft untouched', async () => {
  const send = vi.fn().mockResolvedValue(undefined)
  useChatStore.setState({ sendMessage: send })
  await openComposer('image', { runMode: 'agent', aspectRatio: '16:9', size: '2K' })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  const [text, segments, , attachments, target] = send.mock.calls[0]!
  expect(text).toContain('media_generate_image')
  expect(text).toContain('A mountain')
  expect(text).toContain('- size: 2K')
  expect(segments).toEqual([{ text, isPaste: false }])
  expect(attachments).toEqual([])
  expect(target).toEqual(owner)
  expect(api.mediaGenerate).not.toHaveBeenCalled()
  await waitFor(() => expect(composerStackFor(owner).base).toBeNull())
  expect(useChatStore.getState().projectSessions[owner.projectPath]._sessions[owner.sessionId].draftText).toBe('Existing chat draft')
})

it('copies and saves the full generated file through the existing native APIs', async () => {
  const copy = vi.fn<Window['app']['clipboardWriteImage']>().mockResolvedValue({ ok: true })
  const save = vi.fn<Window['app']['saveFileAs']>().mockResolvedValue({ ok: false, canceled: true })
  window.app = Object.assign(Object.create(window.app), { clipboardWriteImage: copy, saveFileAs: save })
  await openComposer()
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Copy' }))
  await waitFor(() => expect(copy).toHaveBeenCalledWith('/generated.png'))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith('/generated.png', 'generated.png'))
})
