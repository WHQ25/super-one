import { useAppStore } from '@/stores/app'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { useSessionScope } from '@/stores/chat-store/session-scope'
import { remoteActiveFileRoot } from '@superone/shared/remote-resource-key'

/** Every mention producer follows the pane's host and its actual checkout. */
export function useMentionContext() {
  const scope = useSessionScope()
  const activeProject = useChatStore(s => s.activeProject)
  const currentFolder = useAppStore(s => s.currentFolder)
  const projectPath = scope?.projectPath ?? activeProject ?? currentFolder
  const cwd = useActiveSession(s => s.cwd)
  const worktree = useAppStore(s => projectPath ? s._worktrees[projectPath]?.activePath : null)
  return {
    projectPath,
    fileRoot: projectPath ? remoteActiveFileRoot(projectPath, cwd || worktree) : null,
  }
}
