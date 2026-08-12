import { Copy, Eye, EyeOff, FolderOpen, GitFork, MessageSquarePlus, Pencil, PictureInPicture2, Pin, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import type { SessionForkMode, SessionHistoryEntry } from '@superone/shared/agent-types'
import { providerSessionIdFromResume } from '@superone/shared/environment'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'

export interface SessionMenuHandlers {
  onRename: () => void
  onPin: () => void
  onHide: () => void
  onFork: (mode: SessionForkMode) => void
  onDelete?: () => void
  /** Insert a session (`@chat`) mention chip into the active chat composer. */
  onAddToChat?: () => void
}

export function providerLabelFor(session: SessionHistoryEntry): string {
  if (session.provider === 'codex') return 'Codex'
  if (session.provider === 'acp') {
    return session.acpAgentId?.toLowerCase().includes('grok') ? 'Grok (ACP)' : 'ACP'
  }
  if (session.provider === 'opencode') return 'OpenCode'
  return 'Claude Code'
}

/**
 * Resolve the harness-native session id for clipboard (Claude SDK / Codex thread / …).
 * Local rows carry `providerSessionId`; remote list may omit it until refreshed —
 * fall back to session.get `providerResume` / `providerSessionId` on the node.
 * Falls back to SuperOne `sessionId` only when no harness id is available yet.
 */
export async function resolveSessionIdForCopy(
  session: SessionHistoryEntry,
  folderPath: string,
): Promise<{ id: string; isHarnessId: boolean }> {
  if (session.providerSessionId?.trim()) {
    return { id: session.providerSessionId.trim(), isHarnessId: true }
  }
  const remote = parseRemoteProjectKey(folderPath)
  if (remote && typeof window.environment?.getSession === 'function') {
    try {
      const snap = (await window.environment.getSession(
        remote.connectionId,
        session.sessionId,
      )) as {
        providerSessionId?: string | null
        providerResume?: string | null
      } | null
      const bare =
        (typeof snap?.providerSessionId === 'string' && snap.providerSessionId.trim()
          ? snap.providerSessionId.trim()
          : null) ?? providerSessionIdFromResume(snap?.providerResume)
      if (bare) return { id: bare, isHarnessId: true }
    } catch {
      /* fall through to SuperOne session id */
    }
  }
  return { id: session.sessionId, isHarnessId: false }
}

export function buildSessionMenuItems(
  session: SessionHistoryEntry,
  folderPath: string,
  t: TFunction,
  handlers: SessionMenuHandlers,
): AdaptiveMenuEntry[] {
  const isRemoteHost = folderPath.startsWith('remote:')
  // Host absolute path for clipboard when project is keyed as remote:<conn>:<path>
  const hostPath = isRemoteHost
    ? folderPath.slice(folderPath.indexOf(':', 'remote:'.length) + 1) || folderPath
    : folderPath

  const items: AdaptiveMenuEntry[] = [
    { kind: 'item', id: 'rename', label: t('sidebar.contextMenu.rename'), icon: Pencil, onSelect: handlers.onRename },
    { kind: 'item', id: 'pin', label: session.isPinned ? t('sidebar.contextMenu.unpin') : t('sidebar.contextMenu.pin'), icon: Pin, onSelect: handlers.onPin },
    { kind: 'item', id: 'hide', label: session.isHidden ? t('sidebar.contextMenu.unhide') : t('sidebar.contextMenu.hide'), icon: session.isHidden ? Eye : EyeOff, onSelect: handlers.onHide },
    { kind: 'separator' },
    // Mini window is a desktop shell around the same chat store; remote: project keys work via selectProject/switchSession.
    {
      kind: 'item',
      id: 'mini',
      label: t('sidebar.contextMenu.openInMiniWindow'),
      icon: PictureInPicture2,
      onSelect: () => window.app.openSessionWindow(folderPath, session.sessionId, session.title),
    },
    { kind: 'separator' },
  ]

  if (handlers.onAddToChat) {
    items.push({
      kind: 'item',
      id: 'addToChat',
      label: t('sidebar.contextMenu.addToChat'),
      icon: MessageSquarePlus,
      onSelect: handlers.onAddToChat,
    })
  }

  items.push(
    {
      kind: 'item',
      id: 'copyId',
      // Provider / harness session id (Claude SDK, Codex thread, …) — what users paste into CLI tools.
      label: t('sidebar.contextMenu.copySessionId'),
      icon: Copy,
      onSelect: () => {
        const providerLabel = providerLabelFor(session)
        void resolveSessionIdForCopy(session, folderPath).then(({ id, isHarnessId }) => {
          navigator.clipboard.writeText(id)
          toast.success(
            isHarnessId
              ? `${providerLabel} ${t('sidebar.contextMenu.sessionIdCopiedToast')}`
              : `${providerLabel} ${t('sidebar.contextMenu.sessionIdNotReadyToast')}`,
          )
        })
      },
    },
    {
      kind: 'item',
      id: 'copyDir',
      label: t('sidebar.contextMenu.copyWorkingDirectory'),
      icon: Copy,
      onSelect: () => {
        const dir = session.worktreePath ?? hostPath
        navigator.clipboard.writeText(dir)
        toast.success(t('sidebar.contextMenu.workingDirCopiedToast'))
      },
    },
  )

  // Local disk only — remote host paths are not this machine's Finder/Explorer.
  if (!isRemoteHost) {
    items.push({
      kind: 'item',
      id: 'openFolder',
      label: t('sidebar.contextMenu.openFolder'),
      icon: FolderOpen,
      onSelect: () => window.app.showInFolder(session.worktreePath ?? folderPath, ''),
    })
  }

  // Fork to new worktree vs same directory (mode: worktree | local). Label is
  // shared for local and remote — "Same Worktree" avoids implying the
  // controlling desktop host on remote projects.
  if (!session.isWorktree) {
    items.push(
      { kind: 'separator' },
      { kind: 'item', id: 'forkWorktree', label: t('sidebar.contextMenu.forkToWorktree'), icon: GitFork, onSelect: () => handlers.onFork('worktree') },
      {
        kind: 'item',
        id: 'forkLocal',
        label: t('sidebar.contextMenu.forkToSameWorktree'),
        icon: GitFork,
        onSelect: () => handlers.onFork('local'),
      },
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
