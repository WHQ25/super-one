/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MediaComposerAPI, MediaComposerResult } from '@superone/shared/media-composer'
import { PNG_ATTACHMENT } from '@superone/shared/test-fixtures/attachments'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { composerStackFor, topComposer, useComposerStacks } from '../composer-slot/composer-stack'
import { composerForSession, renderComposer } from '../composer-slot/composer-registry'
import { openMediaComposer } from './open-media-composer'
import { useMediaRuns } from './media-composer-runs'

const owner = { projectPath: '/media-composer-test', sessionId: 'first' }
const previousChat = useChatStore.getState()
const previousEnvironment = window.environment
const previousApp = window.app
const previousCatalog = useAppStore.getState().harnessCatalog
const api = { mediaModels: vi.fn(), mediaGenerate: vi.fn(), mediaCancel: vi.fn(), mediaVideoStatus: vi.fn(), mediaPendingVideos: vi.fn() } satisfies MediaComposerAPI
const imageResult: MediaComposerResult = { generationId: 'image-result', kind: 'image', status: 'succeeded', files: [{
  path: '/generated.png', agentPath: '/generated.png', mediaType: PNG_ATTACHMENT.mimeType, base64: PNG_ATTACHMENT.base64,
}] }
function Harness() {
  const entry = useComposerStacks(state => topComposer(owner, state))
  const decision = useChatStore(state => state.projectSessions[owner.projectPath]?._sessions[owner.sessionId].pendingPermissions.length)
  if (decision) return <p>Decision owns the slot</p>
  return entry && renderComposer(entry.id, owner.sessionId, { openedComposer: entry, showTodoPopup: false, autoFocusOnMount: false, onBaseComposerMounted() {}, microphoneShortcutEnabled: false })
}
beforeEach(() => {
  vi.resetAllMocks()
  const session = { ...createDefaultPerSessionState(), draftText: 'Existing chat draft' }
  useChatStore.setState({ activeProject: owner.projectPath, projectSessions: {
    [owner.projectPath]: { ...createDefaultProjectState(), _activeSessionId: owner.sessionId, _sessions: { [owner.sessionId]: session } },
  } })
  useAppStore.setState({ harnessCatalog: null })
  window.environment = { ...previousEnvironment, ...api }
  api.mediaModels.mockImplementation(async kind => [{ providerId: 'key', providerLabel: 'Provider', model: `${kind}-model`, label: 'Model', default: true }])
  api.mediaGenerate.mockResolvedValue(imageResult)
  api.mediaCancel.mockResolvedValue(undefined)
  api.mediaPendingVideos.mockResolvedValue([])
})
afterEach(() => {
  act(() => composerForSession(owner).returnToChat())
  useChatStore.setState(previousChat); useAppStore.setState({ harnessCatalog: previousCatalog })
  window.environment = previousEnvironment
  window.app = previousApp
  vi.restoreAllMocks()
})
async function open(kind: 'image' | 'video' = 'image', output: 'caller' | 'agent' = 'caller') {
  await act(async () => { void openMediaComposer(owner, kind, { prompt: 'A mountain', output }) })
  render(<Harness />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled())
}
it('starts at one row and uses Shift+Enter and Alt+Enter to insert newlines without generating', async () => {
  await open()
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
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  expect(api.mediaGenerate).toHaveBeenCalledWith(expect.objectContaining({ ...owner, providerId: 'key', model: 'image-model', prompt: 'A mountain' }))
  act(() => useChatStore.setState(state => {
    const project = state.projectSessions[owner.projectPath]
    return { projectSessions: { ...state.projectSessions, [owner.projectPath]: { ...project, _sessions: {
      ...project._sessions, [owner.sessionId]: { ...project._sessions[owner.sessionId], pendingPermissions: [{ requestId: 'permission', toolName: 'Bash', input: {}, allowAlwaysAllow: false }] },
    } } } }
  }))
  expect(screen.getByText('Decision owns the slot')).toBeInTheDocument()
  await act(async () => resolve(imageResult))
  expect(api.mediaCancel).not.toHaveBeenCalled()
  act(() => useChatStore.setState(state => {
    const project = state.projectSessions[owner.projectPath]
    return { projectSessions: { ...state.projectSessions, [owner.projectPath]: { ...project, _sessions: {
      ...project._sessions, [owner.sessionId]: { ...project._sessions[owner.sessionId], pendingPermissions: [] },
    } } } }
  }))
  expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('A mountain')
  expect(screen.getByRole('button', { name: 'Insert into Draft' })).toBeEnabled()
  expect(api.mediaGenerate).toHaveBeenCalledTimes(1)
})
it('cancels when the mode closes and ignores a late provider result', async () => {
  let resolve!: (result: MediaComposerResult) => void
  api.mediaGenerate.mockImplementation(() => new Promise(done => { resolve = done }))
  await open()
  const entry = topComposer(owner)!
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  fireEvent.click(screen.getByRole('button', { name: 'Back to Chat' }))
  expect(api.mediaCancel).toHaveBeenCalledWith(expect.any(String))
  await act(async () => resolve(imageResult))
  expect(useMediaRuns.getState().runs[entry.key]).toBeUndefined()
  expect(composerStackFor(owner).base).toBeNull()
})
it('keeps a video pending after a transport error and resumes status checks without resubmitting', async () => {
  api.mediaGenerate.mockResolvedValue({ generationId: 'video', kind: 'video', status: 'running', files: [] })
  api.mediaVideoStatus.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ generationId: 'video', kind: 'video', status: 'succeeded', files: [{ path: '/video.mp4', agentPath: '/video.mp4', mediaType: 'video/mp4' }] })
  await open('video')
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Check Status' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('offline')
  expect(screen.getByText('Video is generating')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Check Status' }))
  expect(await screen.findByRole('button', { name: 'Insert into Draft' })).toBeEnabled()
  expect(api.mediaGenerate).toHaveBeenCalledTimes(1)
})
it('restores a durable video handle when the composer is reopened', async () => {
  api.mediaPendingVideos.mockResolvedValue([{ generationId: 'restored', kind: 'video', status: 'running', files: [] }])
  await act(async () => { void openMediaComposer(owner, 'video') })
  render(<Harness />)
  expect(await screen.findByText('Video is generating')).toBeInTheDocument()
  expect(api.mediaGenerate).not.toHaveBeenCalled()
  expect(api.mediaPendingVideos).toHaveBeenCalledWith(owner)
})
it('shows actionable provider setup when no media model is enabled', async () => {
  api.mediaModels.mockResolvedValue([])
  await act(async () => { void openMediaComposer(owner, 'image') })
  render(<Harness />)
  expect(await screen.findByRole('button', { name: 'Open Providers' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
})
it('does not send an agent result twice when a decision unmounts the composer during delivery', async () => {
  let delivered!: () => void
  const send = vi.fn(() => new Promise<void>(resolve => { delivered = resolve }))
  useChatStore.setState({ sendMessage: send })
  await open('image', 'agent')
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  const setDecision = (pending: boolean) => useChatStore.setState(state => {
    const project = state.projectSessions[owner.projectPath]
    return { projectSessions: { ...state.projectSessions, [owner.projectPath]: { ...project, _sessions: {
      ...project._sessions, [owner.sessionId]: { ...project._sessions[owner.sessionId], pendingPermissions: pending ? [{ requestId: 'permission', toolName: 'Bash', input: {}, allowAlwaysAllow: false }] : [] },
    } } } }
  })
  act(() => setDecision(true))
  await act(async () => delivered())
  act(() => setDecision(false))
  await screen.findByRole('button', { name: 'Use Results' })
  expect(send).toHaveBeenCalledTimes(1)
})
it('copies and saves the full generated file through the existing native APIs', async () => {
  const copy = vi.fn<Window['app']['clipboardWriteImage']>().mockResolvedValue({ ok: true })
  const save = vi.fn<Window['app']['saveFileAs']>().mockResolvedValue({ ok: false, canceled: true })
  window.app = Object.assign(Object.create(previousApp), { clipboardWriteImage: copy, saveFileAs: save })
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Copy' }))
  await waitFor(() => expect(copy).toHaveBeenCalledWith('/generated.png'))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith('/generated.png', 'generated.png'))
})
