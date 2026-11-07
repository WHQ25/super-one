/** @vitest-environment jsdom */
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { SessionScopeProvider } from '@/stores/chat-store/session-scope'
import { MentionPopup } from './MentionPopup'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const PROJECT = 'remote:node-b:/srv/repo'
const ROOT = 'remote:node-b:/srv/worktree'
const scope = { projectPath: PROJECT, sessionId: 'remote-chat' }
function popup(query: string) {
  return <SessionScopeProvider value={scope}><MentionPopup query={query} selectedIndex={0}
    onSelect={() => {}} onSetSelectedIndex={() => {}} onClose={() => {}} /></SessionScopeProvider>
}

describe('mention resources in a remote session pane', () => {
  beforeEach(() => {
    useAppStore.setState({ currentFolder: '/local/repo', _worktrees: {} })
    useChatStore.getState().ensureSession(PROJECT)
    const project = useChatStore.getState().projectSessions[PROJECT]!
    useChatStore.setState({ activeProject: '/local/repo', projectSessions: {
      ...useChatStore.getState().projectSessions,
      [PROJECT]: { ...project, _activeSessionId: scope.sessionId, _sessions: {
        ...project._sessions, [scope.sessionId]: { ...Object.values(project._sessions)[0]!, cwd: '/srv/worktree' },
      } },
    } })
    Object.assign(window.environment, {
      listDirectory: vi.fn(async () => []), searchMentions: vi.fn(async () => []),
      searchSessionsByTitle: vi.fn(async () => []), listRemoteCollabProfiles: vi.fn(async () => [
        { id: 'remote-reviewer', name: 'Remote reviewer', harnessId: 'codex' },
      ]),
      getMentionCatalog: vi.fn(async () => ({ capabilityIds: [], apps: [] })),
    })
    Object.assign(window.app, {
      getGitMentionCapabilities: vi.fn(async () => ({ repo: 'ready', github: true })),
      listGitMentionRefs: vi.fn(async () => ({ ok: true, refs: [] })),
      getAppSettings: vi.fn(async () => ({ cdpEnabled: true, computerUseEnabled: true })),
      listComputerUseInstalledApps: vi.fn(async () => [{ bundleId: 'local-only', app: 'Local only', aliases: [] }]),
    })
  })

  it('uses the pane host and its session checkout for git, GitHub, files and collaborators', async () => {
    const view = render(popup('git branch '))
    await waitFor(() => expect(window.app.listGitMentionRefs).toHaveBeenCalledWith(ROOT, 'branch', ''))
    expect(window.app.getGitMentionCapabilities).toHaveBeenCalledWith(ROOT)
    expect(window.environment.listRemoteCollabProfiles).toHaveBeenCalledWith('node-b')
    view.rerender(popup('gh pr '))
    await waitFor(() => expect(window.app.listGitMentionRefs).toHaveBeenCalledWith(ROOT, 'pr', ''))
    view.rerender(popup(''))
    await waitFor(() => expect(window.environment.listDirectory).toHaveBeenCalledWith(ROOT, ''))
    view.rerender(popup('session '))
    await waitFor(() => expect(window.environment.searchSessionsByTitle).toHaveBeenCalledWith('node-b', '', 50, undefined))
  })

  it('shows the node catalog and never loads controller application icons', async () => {
    vi.mocked(window.environment.getMentionCatalog).mockResolvedValue({ capabilityIds: ['computer'], apps: [
      { kind: 'miniapp', path: 'remote-board', label: 'Remote board' },
      { kind: 'desktop-app', path: 'remote-editor', label: 'Remote editor' },
    ], environments: [{ role: 'local', id: 'env-b', label: 'Build node', status: 'connected' }] })
    const resolveIcon = vi.fn()
    Object.assign(window.app, { resolveComputerUseAppIcon: resolveIcon })
    const view = render(popup('Remote'))
    await waitFor(() => expect(view.container.textContent).toContain('Remote board'))
    expect(view.container.textContent).toContain('Remote editor')
    expect(resolveIcon).not.toHaveBeenCalled()
    view.rerender(popup('env '))
    await waitFor(() => expect(view.container.textContent).toContain('Build node'))
  })

  it('does not advertise the controller desktop capabilities or installed apps', async () => {
    const { container } = render(popup(''))
    await waitFor(() => expect(window.environment.getMentionCatalog).toHaveBeenCalledWith(PROJECT))
    expect(window.app.getAppSettings).not.toHaveBeenCalled()
    expect(window.app.listComputerUseInstalledApps).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Local only')
  })
})
