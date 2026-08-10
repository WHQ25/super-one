import { useCallback, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { Ellipsis } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import type { SessionForkMode, SessionHistoryEntry } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { chatInputAPI } from '@/components/chat/ChatInput'
import { buildSessionMenuItems } from '@/lib/session-menu-items'
import { showNativeContextMenu, toNativeMenu } from '@/lib/native-context-menu'
import { RenameSessionDialog, type RenameSessionTarget } from '@/components/sidebar/RenameSessionDialog'

const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties

export function HeaderSessionMenu({ sessionId, folderPath }: { sessionId: string; folderPath: string }) {
  const { t } = useTranslation()
  const liquidGlass = useAppStore((s) => s.liquidGlass)
  const [open, setOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<RenameSessionTarget | null>(null)

  const entry = useChatStore(
    useShallow((s): SessionHistoryEntry | null => {
      const proj = s.projectSessions[folderPath]
      if (!proj) return null
      const persisted = proj.sessions.find((e) => e.sessionId === sessionId)
      if (persisted) return persisted
      const live = proj._sessions[sessionId]
      if (!live || live.messages.length === 0) return null
      return {
        sessionId,
        title: live._title ?? '',
        lastActiveAt: '',
        provider: live.sessionProvider ?? undefined,
        providerSessionId: live._providerSessionId ?? undefined,
        worktreePath: live._worktreePath ?? undefined,
        isWorktree: !!live._worktreePath,
        gitBranch: live._gitBranch ?? undefined,
        messageCount: 0,
      }
    }),
  )

  const afterMutate = useCallback(async () => {
    await useChatStore.getState().fetchSessions()
    useAppStore.getState().bumpSessionListNonce()
  }, [])

  const handleFork = useCallback(async (mode: SessionForkMode) => {
    const toastId = toast.loading(t('sidebar.contextMenu.forkingToast'))
    try {
      const { parseRemoteProjectKey } = await import('@/lib/remote-project-key')
      const remote = parseRemoteProjectKey(folderPath)
      const result = remote
        ? await window.environment.forkSession(remote.connectionId, { sessionId, mode })
        : await window.app.forkSession({ sessionId, mode })
      if (result.ok) {
        await useChatStore.getState().switchToSession(folderPath, result.sessionId)
        await afterMutate()
        toast.success(t(mode === 'local' ? 'sidebar.contextMenu.forkedLocalToast' : 'sidebar.contextMenu.forkedToast'), { id: toastId })
      } else {
        toast.error(result.error, { id: toastId })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { id: toastId })
    }
  }, [sessionId, folderPath, t, afterMutate])

  if (!entry) return null

  const items = buildSessionMenuItems(entry, folderPath, t, {
    onRename: () => setRenameTarget({ sessionId: entry.sessionId, title: entry.title, folderPath }),
    onPin: async () => {
      const { parseRemoteProjectKey } = await import('@/lib/remote-project-key')
      const remote = parseRemoteProjectKey(folderPath)
      if (remote) {
        await window.environment.setSessionUiFlags(remote.connectionId, entry.sessionId, {
          isPinned: !entry.isPinned,
        })
      } else {
        await window.app.pinSession(entry.sessionId, !entry.isPinned)
      }
      await afterMutate()
    },
    onHide: async () => {
      const { parseRemoteProjectKey } = await import('@/lib/remote-project-key')
      const remote = parseRemoteProjectKey(folderPath)
      if (remote) {
        await window.environment.setSessionUiFlags(remote.connectionId, entry.sessionId, {
          isHidden: !entry.isHidden,
        })
      } else {
        await window.app.hideSession(entry.sessionId, !entry.isHidden)
      }
      await afterMutate()
    },
    onFork: handleFork,
    onAddToChat: () => {
      // Same chip as @session mention (History icon / blended), not mini-app context inject.
      const title = (entry.title || 'Untitled').trim()
      chatInputAPI.insertMention?.('session', entry.sessionId, title)
      toast.success(t('sidebar.contextMenu.sessionAddedToChatToast'))
    },
  })

  const dialog = (
    <RenameSessionDialog target={renameTarget} onClose={() => setRenameTarget(null)} onRenamed={() => void afterMutate()} />
  )

  if (liquidGlass) {
    return (
      <>
        <IconButton
          variant="nested"
          size="xs"
          aria-label="Session actions"
          style={NO_DRAG}
          className="shrink-0 opacity-0 transition-opacity group-hover/htitle:opacity-100"
          onClick={() => void showNativeContextMenu(toNativeMenu(items))}
        >
          <Ellipsis />
        </IconButton>
        {dialog}
      </>
    )
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <IconButton
            variant="nested"
            size="xs"
            aria-label="Session actions"
            style={NO_DRAG}
            className={cn('shrink-0 transition-opacity', open ? 'opacity-100' : 'opacity-0 group-hover/htitle:opacity-100')}
          >
            <Ellipsis />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {items.map((item, i) =>
            item.kind === 'separator' ? (
              <DropdownMenuSeparator key={i} />
            ) : (
              <DropdownMenuItem
                key={item.id}
                variant={item.destructive ? 'destructive' : 'default'}
                disabled={item.disabled}
                onClick={item.onSelect}
                className="text-xs"
              >
                {item.icon ? <item.icon className="size-3.5" /> : null}
                {item.label}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog}
    </>
  )
}
