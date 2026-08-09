import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { GitFork, Loader2, Split } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import type { ChatMessage, SessionForkMode } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'

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
      const { parseRemoteProjectKey } = await import('@/lib/remote-project-key')
      const remote = projectPath ? parseRemoteProjectKey(projectPath) : null
      const result = remote
        ? await window.environment.forkSession(remote.connectionId, {
            sessionId,
            mode,
            forkFromMessageId: message.id,
          })
        : await window.app.forkSession({ sessionId, mode, forkFromMessageId: message.id })
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
