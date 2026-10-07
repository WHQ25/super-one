import { beforeEach, describe, expect, it, vi } from 'vitest'
import { switchToProjectSession } from './switch-to-session'

const app = vi.hoisted(() => ({ selectedHostConnectionId: 'local', selectProject: vi.fn() }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => app } }))

type NavigationState = ReturnType<Parameters<typeof switchToProjectSession>[0]>
function source(projectPath = '/source', sessionId = 'source') {
  return { activeProject: projectPath, projectSessions: { [projectPath]: { _activeSessionId: sessionId } }, switchSession: vi.fn().mockResolvedValue(undefined) } as unknown as NavigationState
}

beforeEach(() => { app.selectProject.mockReset(); app.selectedHostConnectionId = 'local' })
describe('cross-project session navigation', () => {
  it('opens the remote key on its owning connection while the sidebar selects local', async () => {
    const state = source()
    const target = 'remote:cli-lab:/work/app'
    app.selectProject.mockImplementation(async (path, options) => {
      if (options?.connectionId === 'cli-lab') state.activeProject = path
    })
    await switchToProjectSession(() => state, target, 'target')
    expect(app.selectProject).toHaveBeenCalledWith(target, { connectionId: 'cli-lab' })
    expect(state.switchSession).toHaveBeenCalledWith('target')
  })

  it('opens a local source on local when returning from a remote sidebar selection', async () => {
    app.selectedHostConnectionId = 'cli-lab'
    const state = source('remote:cli-lab:/work/app')
    app.selectProject.mockImplementation(async (path, options) => {
      if (options?.connectionId === 'local') state.activeProject = path
    })
    await switchToProjectSession(() => state, '/source', 'source')
    expect(app.selectProject).toHaveBeenCalledWith('/source', { connectionId: 'local' })
    expect(state.switchSession).toHaveBeenCalledWith('source')
  })

  it('does not restore a session into the old project when project selection fails', async () => {
    const state = source()
    app.selectProject.mockResolvedValue(undefined)
    await expect(switchToProjectSession(() => state, 'remote:cli-lab:/work/app', 'target')).rejects.toThrow('could not be opened')
    expect(state.switchSession).not.toHaveBeenCalled()
    expect(state.activeProject).toBe('/source')
  })

  it('refreshes a remembered remote active session after cross-project navigation', async () => {
    const state = source()
    const target = 'remote:cli-lab:/work/app'
    state.projectSessions[target] = { _activeSessionId: 'target' } as NavigationState['projectSessions'][string]
    app.selectProject.mockImplementation(async path => { state.activeProject = path })
    await switchToProjectSession(() => state, target, 'target')
    expect(state.switchSession).toHaveBeenCalledWith('target')
  })

  it('does not select a project or restore the already active session', async () => {
    const state = source()
    await switchToProjectSession(() => state, '/source', 'source')
    expect(app.selectProject).not.toHaveBeenCalled()
    expect(state.switchSession).not.toHaveBeenCalled()
    await switchToProjectSession(() => state, '/source', 'other')
    expect(state.switchSession).toHaveBeenCalledWith('other')
  })
})
