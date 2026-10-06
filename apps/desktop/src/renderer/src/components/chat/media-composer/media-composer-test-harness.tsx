import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import type { MediaComposerAPI, MediaComposerKind, MediaComposerResult } from '@superone/shared/media-composer'
import { PNG_ATTACHMENT } from '@superone/shared/test-fixtures/attachments'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { topComposer, useComposerStacks, type ComposerValue } from '../composer-slot/composer-stack'
import { composerForSession, renderComposer } from '../composer-slot/composer-registry'
import { openMediaComposer } from './open-media-composer'

export const owner = { projectPath: '/media-composer-test', sessionId: 'first' }
export const api = { mediaModels: vi.fn(), mediaGenerate: vi.fn(), mediaCancel: vi.fn(), mediaVideoStatus: vi.fn(), mediaPendingVideos: vi.fn() } satisfies MediaComposerAPI
export const imageResult: MediaComposerResult = { generationId: 'image-result', kind: 'image', status: 'succeeded', files: [{
  path: '/generated.png', agentPath: '/generated.png', mediaType: PNG_ATTACHMENT.mimeType, base64: PNG_ATTACHMENT.base64,
}] }

function Harness() {
  const entry = useComposerStacks(state => topComposer(owner, state))
  const decision = useChatStore(state => state.projectSessions[owner.projectPath]?._sessions[owner.sessionId].pendingPermissions.length)
  if (decision) return <p>Decision owns the slot</p>
  return entry && renderComposer(entry.id, owner.sessionId, { openedComposer: entry, showTodoPopup: false, autoFocusOnMount: false, onBaseComposerMounted() {}, microphoneShortcutEnabled: false })
}

export function setDecision(pending: boolean) {
  act(() => useChatStore.setState(state => {
    const project = state.projectSessions[owner.projectPath]
    return { projectSessions: { ...state.projectSessions, [owner.projectPath]: { ...project, _sessions: {
      ...project._sessions, [owner.sessionId]: { ...project._sessions[owner.sessionId], pendingPermissions: pending ? [{ requestId: 'permission', toolName: 'Bash', input: {}, allowAlwaysAllow: false }] : [] },
    } } } }
  }))
}

/** Installs a session, stubbed media environment, and cleanup for the media composer suites. */
export function useMediaComposerHarness() {
  const previousChat = useChatStore.getState()
  const previousEnvironment = window.environment
  const previousApp = window.app
  const previousCatalog = useAppStore.getState().harnessCatalog
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
}

export async function openComposer(kind: MediaComposerKind = 'image', prefill?: ComposerValue) {
  await act(async () => { void openMediaComposer(owner, kind, { prompt: 'A mountain', prefill }) })
  render(<Harness />)
  await waitFor(() => expect(screen.getByRole('button', { name: prefill?.runMode === 'agent' ? 'Send' : 'Generate' })).toBeEnabled())
}

export async function openWithoutWaiting(kind: MediaComposerKind) {
  await act(async () => { void openMediaComposer(owner, kind) })
  render(<Harness />)
}
