import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import type { SessionForkMode, SessionHistoryEntry } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useRealtimeCallStore } from '@/stores/realtime-call'
import { selectPanelFillsWindow, useActivityPanelStore } from '@/stores/activity-panel'
import { setChatFloating } from '@/lib/layout-actions'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { isRunningChildSettleError } from '@/lib/session-client'
import { buildChatFormItems, buildSessionMenuItems, canSettleSession } from '@/lib/session-menu-items'
import { useSpawnChildTurnOpen } from '@/lib/spawn-child-turn'
import { setUnseenCompleted } from '@/stores/chat-store/helpers/unseen-completed'
import { requestSideChat, useCanOpenSideChat } from '@/lib/side-chat-actions'
import { showNativeContextMenu, toNativeMenu, type AdaptiveMenuEntry } from '@/lib/native-context-menu'
import { RenameSessionDialog, type RenameSessionTarget } from '@/components/sidebar/RenameSessionDialog'

const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties

/**
 * The active list omits settled rows, so an open settled session is not in
 * `projectSessions[].sessions`. The host record still carries the flag.
 * `null` means the host did not answer; the caller keeps the listed value.
 */
async function readSessionSettled(folderPath: string, sessionId: string): Promise<boolean | null> {
  const connectionId = parseRemoteProjectKey(folderPath)?.connectionId ?? 'local'
  try {
    const snap = await window.environment?.getSession?.(connectionId, sessionId) as { isSettled?: boolean } | null | undefined
    if (!snap || typeof snap !== 'object') return null
    return snap.isSettled === true
  } catch {
    return null
  }
}

function DropdownMenuEntries({ items }: { items: AdaptiveMenuEntry[] }) {
  return items.map((item, i) => {
    if (item.kind === 'separator') return <DropdownMenuSeparator key={i} />
    if (item.kind === 'submenu') {
      return (
        <DropdownMenuSub key={item.id}>
          <DropdownMenuSubTrigger className="text-xs">
            {item.icon ? <item.icon className="size-3.5" /> : null}
            {item.label}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuEntries items={item.items} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )
    }
    return (
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
    )
  })
}

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

  const isLive = useChatStore((s) => !!s.projectSessions[folderPath]?._sessions[sessionId])
  const status = useChatStore((s) => s.projectSessions[folderPath]?._sessions[sessionId]?.status)
  const provider = useChatStore((s) => {
    const proj = s.projectSessions[folderPath]
    return proj?.sessions.find((e) => e.sessionId === sessionId)?.provider
      ?? proj?._sessions[sessionId]?.sessionProvider
  })
  const realtimeVoice = useRealtimeCallStore((s) => (
    !!provider && HARNESS_CAPABILITIES[provider].supportsRealtimeVoice === true
      && s.sessionId === sessionId && s.state !== 'idle'
  ))
  const childTurnOpen = useSpawnChildTurnOpen(folderPath, sessionId)
  const sideChatAvailable = useCanOpenSideChat(sessionId)
  const chatFloating = useActivityPanelStore(selectPanelFillsWindow)
  // Listed rows omit a settled session. The host read fills that in, and a
  // click in this menu wins over a read that was already in flight.
  const localChoice = useRef<boolean | null>(null)
  const [fetchedSettled, setFetchedSettled] = useState<boolean | null>(null)
  useEffect(() => {
    localChoice.current = null
    setFetchedSettled(null)
    let cancelled = false
    void readSessionSettled(folderPath, sessionId).then((value) => {
      if (cancelled || localChoice.current != null || value == null) return
      setFetchedSettled(value)
    })
    return () => { cancelled = true }
  }, [folderPath, sessionId])

  const afterMutate = useCallback(async () => {
    await useChatStore.getState().fetchSessions()
    useAppStore.getState().bumpSessionListNonce()
  }, [])

  const handleFork = useCallback(async (mode: SessionForkMode) => {
    const toastId = toast.loading(t('sidebar.contextMenu.forkingToast'))
    try {
      const { forkSession } = await import('@/lib/session-client')
      const result = await forkSession(folderPath, { sessionId, mode })
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

  if (!entry && !isLive) return null

  const chatView = { floating: chatFloating, onToggle: () => setChatFloating(!chatFloating) }
  const isSettled = fetchedSettled ?? entry?.isSettled === true

  // Header menu acts on the session you are already reading, so it deliberately
  // diverges from the sidebar row menu: no Add to Chat (mentioning the session
  // you are typing in is a no-op), and the mini window converts this window
  // instead of spawning a second one. Settle toggles here too. Pin stays off a
  // settled session, matching the row. A new session with no message yet has
  // nothing to rename, pin, settle or fork, so it only offers the entries that
  // change how the chat is shown.
  const itemsFor = (settled: boolean) => entry
    ? buildSessionMenuItems(
        { ...entry, isSettled: settled || undefined },
        folderPath,
        t,
        {
          onRename: () => setRenameTarget({ sessionId: entry.sessionId, title: entry.title, folderPath }),
          onPin: async () => {
            const { setSessionFlags } = await import('@/lib/session-client')
            await setSessionFlags(folderPath, entry.sessionId, { isPinned: !entry.isPinned })
            await afterMutate()
          },
          onSettle: async () => {
            const next = !settled
            localChoice.current = next
            setFetchedSettled(next)
            try {
              const { setSessionFlags, setSessionRead } = await import('@/lib/session-client')
              await setSessionFlags(folderPath, entry.sessionId, { isSettled: next })
              if (next) {
                useChatStore.setState((state) => setUnseenCompleted(state, folderPath, entry.sessionId, false))
                try {
                  await setSessionRead(folderPath, entry.sessionId, true)
                } catch (err) {
                  console.warn('[header] setSessionRead failed:', err)
                }
              }
              await afterMutate()
            } catch (err) {
              localChoice.current = settled
              setFetchedSettled(settled)
              console.warn('[header] settle failed:', err)
              toast.error(isRunningChildSettleError(err) ? t('sidebar.contextMenu.settleBlocked') : (err instanceof Error ? err.message : String(err)))
              await afterMutate()
            }
          },
          onFork: handleFork,
          // Only offered where a side chat can actually dock beside the session:
          // the foreground chat of a local project. `resolveSideChatTarget` owns the
          // rest of the rule (forkable harness, non-empty, not already a side chat).
          onNewSideChat: sideChatAvailable ? () => { void requestSideChat() } : undefined,
          chatView,
        },
        { miniWindow: 'convert', allowSettle: canSettleSession(status, { realtimeVoice, isSettled: settled, childTurnOpen }) },
      )
    : buildChatFormItems({ sessionId, title: '' }, folderPath, t, chatView, { miniWindow: 'convert' })
  const items = itemsFor(isSettled)

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
          onClick={() => {
            void (async () => {
              const value = await readSessionSettled(folderPath, sessionId)
              const settledNow = value ?? entry?.isSettled === true
              if (value != null) {
                localChoice.current = null
                setFetchedSettled(value)
              }
              void showNativeContextMenu(toNativeMenu(itemsFor(settledNow)))
            })()
          }}
        >
          <Ellipsis />
        </IconButton>
        {dialog}
      </>
    )
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={(next) => {
        setOpen(next)
        if (!next) return
        void readSessionSettled(folderPath, sessionId).then((value) => {
          if (value == null) return
          localChoice.current = null
          setFetchedSettled(value)
        })
      }}>
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
          <DropdownMenuEntries items={items} />
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog}
    </>
  )
}
