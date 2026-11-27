import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Forward, GitFork, Loader2, Split } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import type { ChatMessage, SessionForkMode } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import { handoffToNewSession } from '@/lib/session-continuation'

interface ForkButtonProps {
  /** The assistant message whose turn marks the fork point. */
  message: ChatMessage
  className?: string
}

/**
 * Fork the conversation up to and including this assistant turn into a new
 * independent session. The request only carries the message id — the source
 * harness resolves it to a transcript truncation point in the main process.
 */
export function ForkButton({ message, className }: ForkButtonProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  const handleFork = async (mode: SessionForkMode) => {
    if (busy) return
    const state = useChatStore.getState()
    const projectPath = state.activeProject
    const sessionId = projectPath ? state.projectSessions[projectPath]?._activeSessionId : null
    if (!sessionId) return

    setBusy(true)
    const toastId = toast.loading(t('sidebar.contextMenu.forkingToast'))
    try {
      const { forkSession } = await import('@/lib/session-client')
      const result = await forkSession(projectPath!, { sessionId, mode, forkFromMessageId: message.id })
      if (result.ok) {
        await useChatStore.getState().switchSession(result.sessionId)
        toast.success(
          t(mode === 'local' ? 'sidebar.contextMenu.forkedLocalToast' : 'sidebar.contextMenu.forkedToast'),
          { id: toastId },
        )
      } else {
        toast.error(result.error, { id: toastId })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { id: toastId })
    }
    setBusy(false)
  }

  const handleHandoff = () => {
    if (busy) return
    const state = useChatStore.getState()
    const projectPath = state.activeProject
    const project = projectPath ? state.projectSessions[projectPath] : undefined
    const sessionId = project?._activeSessionId
    if (!projectPath || !sessionId) return
    const messages = project._sessions[sessionId]?.messages ?? []
    const idx = messages.findIndex((m) => m.id === message.id)
    const upToMessageId = idx >= 0 && idx < messages.length - 1 ? message.id : undefined
    handoffToNewSession(projectPath, sessionId, upToMessageId)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t('tooltips.fork')}
          disabled={busy}
          className={cn('cursor-pointer transition-colors hover:text-foreground disabled:opacity-50', className)}
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Split className="size-3 rotate-90" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem className="text-xs" onClick={handleHandoff}>
          <Forward className="size-3.5" />
          {t('sidebar.contextMenu.handOffToNewSession')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs" onClick={() => handleFork('worktree')}>
          <GitFork className="size-3.5" />
          {t('sidebar.contextMenu.forkToWorktree')}
        </DropdownMenuItem>
        <DropdownMenuItem className="text-xs" onClick={() => handleFork('local')}>
          <GitFork className="size-3.5" />
          {t('sidebar.contextMenu.forkToSameWorktree')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
