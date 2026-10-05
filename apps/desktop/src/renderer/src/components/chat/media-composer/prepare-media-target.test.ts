/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { prepareMediaTarget } from './prepare-media-target'
const owner = { projectPath: 'remote:node:/repo', sessionId: 'draft' }
const previous = useChatStore.getState()
const previousEnvironment = window.environment
const get = vi.fn(), create = vi.fn(), list = vi.fn()
beforeEach(() => {
  get.mockReset().mockResolvedValue(null)
  create.mockReset().mockResolvedValue({ sessionId: 'node-session' })
  list.mockReset().mockResolvedValue([{ projectId: 'project', path: '/repo' }])
  window.environment = { ...previousEnvironment, getSession: get, createSession: create, listProjects: list }
  useChatStore.setState({ activeProject: owner.projectPath, projectSessions: { [owner.projectPath]: {
    ...createDefaultProjectState(), _activeSessionId: owner.sessionId, _sessions: {
      draft: { ...createDefaultPerSessionState(), preferredProvider: 'codex', draftText: 'Original draft' },
      sibling: { ...createDefaultPerSessionState(), draftText: 'Sibling draft' },
    },
  } } })
})
afterEach(() => { useChatStore.setState(previous); window.environment = previousEnvironment })
it('materializes a remote draft before generation without sending an agent turn', async () => {
  expect(await prepareMediaTarget(owner)).toEqual({ ...owner, sessionId: 'node-session' })
  expect(create).toHaveBeenCalledWith('node', { projectId: 'project', harnessId: 'codex', providerId: 'codex' })
  const project = useChatStore.getState().projectSessions[owner.projectPath]
  expect(project._activeSessionId).toBe('node-session')
  expect(project._sessions['node-session']).toMatchObject({ draftText: 'Original draft', hostSessionOwned: true })
})
it('preserves newer draft edits and does not take over a sibling selected during preparation', async () => {
  let finish!: (value: { sessionId: string }) => void
  create.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const work = prepareMediaTarget(owner)
  await vi.waitFor(() => expect(create).toHaveBeenCalled())
  useChatStore.getState().setDraftText('Edited during preparation', owner)
  useChatStore.setState(state => ({ projectSessions: { ...state.projectSessions, [owner.projectPath]: { ...state.projectSessions[owner.projectPath], _activeSessionId: 'sibling' } } }))
  finish({ sessionId: 'node-session' }); await work
  const project = useChatStore.getState().projectSessions[owner.projectPath]
  expect(project._activeSessionId).toBe('sibling')
  expect(project._sessions['node-session'].draftText).toBe('Edited during preparation')
  expect(project._sessions.sibling.draftText).toBe('Sibling draft')
})
it('coalesces simultaneous opens of the same remote draft', async () => {
  const results = await Promise.all([prepareMediaTarget(owner), prepareMediaTarget(owner)])
  expect(create).toHaveBeenCalledTimes(1)
  expect(results[0]).toEqual(results[1])
})
it('does not create a new conversation on transport failure', async () => {
  get.mockRejectedValue(new Error('offline'))
  await expect(prepareMediaTarget(owner)).rejects.toThrow('offline')
  expect(create).not.toHaveBeenCalled()
  expect(useChatStore.getState().projectSessions[owner.projectPath]._sessions.draft.draftText).toBe('Original draft')
})
