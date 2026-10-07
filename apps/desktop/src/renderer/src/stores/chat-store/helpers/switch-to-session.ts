import { useAppStore } from '@/stores/app'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import type { ChatStore } from '../types'

type NavigationState = Pick<ChatStore, 'activeProject' | 'projectSessions' | 'switchSession'>

/** Project keys identify their host independently of the sidebar's selection. */
export async function switchToProjectSession(get: () => NavigationState, projectPath: string, sessionId: string): Promise<void> {
  const state = get()
  if (projectPath === state.activeProject) {
    if (sessionId === state.projectSessions[projectPath]?._activeSessionId) return
    await state.switchSession(sessionId)
    return
  }
  // Keep the sidebar and main chat in sync, including remote → local return.
  const connectionId = parseRemoteProjectKey(projectPath)?.connectionId ?? 'local'
  await useAppStore.getState().selectProject(projectPath, { connectionId })
  const fresh = get()
  if (fresh.activeProject !== projectPath) throw new Error('Session project could not be opened')
  // Remote sessions may have advanced on another client while this project was
  // unfocused. Its remembered active id is not evidence of a current transcript.
  if (connectionId !== 'local' || fresh.projectSessions[projectPath]?._activeSessionId !== sessionId) await fresh.switchSession(sessionId)
}
