import { Copy, Eye, EyeOff, FolderOpen, GitFork, Pencil, PictureInPicture2, Pin, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import type { SessionForkMode, SessionHistoryEntry } from '@superone/shared/agent-types'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'

export interface SessionMenuHandlers {
  onRename: () => void
  onPin: () => void
  onHide: () => void
  onFork: (mode: SessionForkMode) => void
  onDelete?: () => void
}

export function buildSessionMenuItems(
  session: SessionHistoryEntry,
  folderPath: string,
  t: TFunction,
  handlers: SessionMenuHandlers,
): AdaptiveMenuEntry[] {
  const items: AdaptiveMenuEntry[] = [
    { kind: 'item', id: 'rename', label: t('sidebar.contextMenu.rename'), icon: Pencil, onSelect: handlers.onRename },
    { kind: 'item', id: 'pin', label: session.isPinned ? t('sidebar.contextMenu.unpin') : t('sidebar.contextMenu.pin'), icon: Pin, onSelect: handlers.onPin },
    { kind: 'item', id: 'hide', label: session.isHidden ? t('sidebar.contextMenu.unhide') : t('sidebar.contextMenu.hide'), icon: session.isHidden ? Eye : EyeOff, onSelect: handlers.onHide },
    { kind: 'separator' },
    { kind: 'item', id: 'mini', label: t('sidebar.contextMenu.openInMiniWindow'), icon: PictureInPicture2, onSelect: () => window.app.openSessionWindow(folderPath, session.sessionId, session.title) },
    { kind: 'separator' },
    { kind: 'item', id: 'copyId', label: t('sidebar.contextMenu.copySessionId'), icon: Copy, onSelect: () => {
      const providerLabel = session.provider === 'codex' ? 'Codex' : session.provider === 'acp' ? 'ACP' : session.provider === 'opencode' ? 'OpenCode' : 'Claude Code'
      if (session.providerSessionId) {
        navigator.clipboard.writeText(session.providerSessionId)
        toast.success(`${providerLabel} ${t('sidebar.contextMenu.sessionIdCopiedToast')}`)
      } else {
        navigator.clipboard.writeText(session.sessionId)
        toast.success(`${providerLabel} ${t('sidebar.contextMenu.sessionIdNotReadyToast')}`)
      }
    } },
    { kind: 'item', id: 'copyDir', label: t('sidebar.contextMenu.copyWorkingDirectory'), icon: Copy, onSelect: () => { const dir = session.worktreePath ?? folderPath; navigator.clipboard.writeText(dir); toast.success(t('sidebar.contextMenu.workingDirCopiedToast')) } },
    { kind: 'item', id: 'openFolder', label: t('sidebar.contextMenu.openFolder'), icon: FolderOpen, onSelect: () => window.app.showInFolder(session.worktreePath ?? folderPath, '') },
  ]

  if (!session.isWorktree) {
    items.push(
      { kind: 'separator' },
      { kind: 'item', id: 'forkWorktree', label: t('sidebar.contextMenu.forkToWorktree'), icon: GitFork, onSelect: () => handlers.onFork('worktree') },
      { kind: 'item', id: 'forkLocal', label: t('sidebar.contextMenu.forkToLocal'), icon: GitFork, onSelect: () => handlers.onFork('local') },
    )
  }

  if (handlers.onDelete) {
    items.push(
      { kind: 'separator' },
      { kind: 'item', id: 'delete', label: t('sidebar.contextMenu.delete'), icon: Trash2, destructive: true, onSelect: handlers.onDelete },
    )
  }

  return items
}
