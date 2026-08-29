import { Copy, Eye, EyeOff, FolderOpen, GitFork, MessageCirclePlus, MessageSquarePlus, Pencil, PictureInPicture2, Pin, Tag, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import type { SessionForkMode, SessionHistoryEntry } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { providerSessionIdFromResume } from '@superone/shared/environment'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { enterMiniWindow } from '@/stores/window-mini-mode'

export interface SessionMenuHandlers {
  onRename: () => void
  onPin: () => void
  onFork: (mode: SessionForkMode) => void
  /** Sidebar-list affordance — omitted by the chat header menu (you cannot hide the session you are in). */
  onHide?: () => void
  onDelete?: () => void
  /** Insert a `@session` mention chip into the active chat composer. */
  onAddToChat?: () => void
  /** Chat-header affordance — opens an ephemeral side chat forked off this session. */
  onNewSideChat?: () => void
}

export interface SessionMenuOptions {
  /**
   * `open` spawns a separate mini window for the session (sidebar rows, which
   * point at *other* sessions). `convert` turns the window the menu lives in
   * into a mini window for the session it is already showing (chat header).
   */
  miniWindow?: 'open' | 'convert'
}

/**
 * Whether this row's harness can clone a conversation the agent still remembers.
 *
 * A row whose harness is unknown (legacy list entries omit `provider`) is treated
 * as forkable: the entry has been offered there for as long as the feature has
 * existed, and hiding it on a missing field would be a silent regression.
 */
export function sessionSupportsFork(session: SessionHistoryEntry): boolean {
  if (!session.provider) return true
  return HARNESS_CAPABILITIES[session.provider].supportsFork
}

export function providerLabelFor(session: SessionHistoryEntry): string {
  if (session.provider === 'codex') return 'Codex'
  if (session.provider === 'acp') {
    return session.acpAgentId?.toLowerCase().includes('grok') ? 'Grok (ACP)' : 'ACP'
  }
  if (session.provider === 'opencode') return 'OpenCode'
  if (session.provider === 'cursor') return 'Cursor'
  if (session.provider === 'dsh') return 'DeepSeek'
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
  options: SessionMenuOptions = {},
): AdaptiveMenuEntry[] {
  const isRemoteHost = folderPath.startsWith('remote:')
  // Host absolute path for clipboard when project is keyed as remote:<conn>:<path>
  const hostPath = isRemoteHost
    ? folderPath.slice(folderPath.indexOf(':', 'remote:'.length) + 1) || folderPath
    : folderPath
  const tags = session.tags ?? []

  const onHide = handlers.onHide
  const miniMode = options.miniWindow ?? 'open'

  const items: AdaptiveMenuEntry[] = [
    { kind: 'item', id: 'rename', label: t('sidebar.contextMenu.rename'), icon: Pencil, onSelect: handlers.onRename },
    { kind: 'item', id: 'pin', label: session.isPinned ? t('sidebar.contextMenu.unpin') : t('sidebar.contextMenu.pin'), icon: Pin, onSelect: handlers.onPin },
    ...(onHide
      ? [{ kind: 'item' as const, id: 'hide', label: session.isHidden ? t('sidebar.contextMenu.unhide') : t('sidebar.contextMenu.hide'), icon: session.isHidden ? Eye : EyeOff, onSelect: onHide }]
      : []),
    {
      kind: 'submenu',
      id: 'tags',
      label: t('sidebar.contextMenu.tags'),
      icon: Tag,
      items: tags.length
        ? tags.map((tag) => ({
            kind: 'item' as const,
            id: `tag:${tag}`,
            label: tag,
            onSelect: () => {
              void navigator.clipboard.writeText(tag)
              toast.success(t('sidebar.contextMenu.tagCopiedToast'))
            },
          }))
        : [{
            kind: 'item' as const,
            id: 'tags-empty',
            label: t('sidebar.contextMenu.noTags'),
            disabled: true,
            onSelect: () => undefined,
          }],
    },
    { kind: 'separator' },
    // Mini window is a desktop shell around the same chat store; remote: project keys work via selectProject/switchSession.
    {
      kind: 'item',
      id: 'mini',
      label: t(miniMode === 'convert' ? 'sidebar.contextMenu.convertToMiniWindow' : 'sidebar.contextMenu.openInMiniWindow'),
      icon: PictureInPicture2,
      onSelect: () => {
        if (miniMode === 'convert') {
          enterMiniWindow({ projectPath: folderPath, sessionId: session.sessionId, title: session.title })
        } else {
          void window.app.openSessionWindow(folderPath, session.sessionId, session.title)
        }
      },
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
  //
  // Absent rather than disabled on a harness without `supportsFork`: its adapter
  // hands back a session the agent never saw, so the entry would look like it
  // worked while silently dropping the whole conversation.
  const canFork = sessionSupportsFork(session)
  if (!session.isWorktree && canFork) {
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

  // Side chat is a fork that never touches the session list, so it rides the
  // same capability gate. Only the chat header passes the handler — a sidebar
  // row points at a session that is not on screen to put the panel beside.
  if (handlers.onNewSideChat && canFork) {
    items.push(
      { kind: 'separator' },
      {
        kind: 'item',
        id: 'newSideChat',
        label: t('sidebar.contextMenu.newSideChat'),
        icon: MessageCirclePlus,
        onSelect: handlers.onNewSideChat,
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
