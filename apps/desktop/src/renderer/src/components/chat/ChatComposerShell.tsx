import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitFork, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { useChatStore, useActiveSession, useIsRemoteLocked } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { catalogIdForSessionProvider, isCatalogHarnessDisabled } from '@/lib/harness-visibility'
import { resolveSessionIcon, resolveSessionIconFromBrandKey } from '@/components/harness/resolve-session-icon'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'
import { ChatInput } from './ChatInput'
import { ChatStatusBar } from './ChatStatusBar'
import { RemoteComposerBanner } from './RemoteComposerBanner'
import { SessionDecisionPrompts } from './SessionDecisionPrompts'
import { CursorApiKeyDialog } from './CursorApiKeyDialog'
import { TodoPopup } from './TodoPopup'

/**
 * Composer stack — owns NO messages subscription. Stream ticks that only update
 * transcript text should not re-render TipTap / status chrome.
 */
export const ChatComposerShell = memo(function ChatComposerShell({ showTodoPopup }: { showTodoPopup: boolean }) {
  const { t } = useTranslation()
  const worktreeRemoved = useActiveSession((s) => s._worktreeRemoved)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const acpAgentId = useActiveSession((s) => s.acpAgentId)
  const disconnectRemoteSessionAction = useChatStore((s) => s.disconnectRemoteSession)
  const isRemoteLocked = useIsRemoteLocked()
  const remoteDraftId = useActiveSession((s) => s.draftRemoteDeviceId ? s.draftId : null)
  const [disconnectingDraft, setDisconnectingDraft] = useState(false)
  const harnessCatalog = useAppStore((s) => s.harnessCatalog)
  const openHarnessSettings = useAppStore((s) => s.openHarnessSettings)

  const provider = resolveProvider({ sessionProvider, preferredProvider })
  const catalogId = catalogIdForSessionProvider(provider, acpAgentId)
  const harnessDisabled = catalogId != null && isCatalogHarnessDisabled(harnessCatalog, catalogId)
  const harnessLabel = catalogId
    ? t(`settings.harnesses.ids.${catalogId}` as 'settings.harnesses.ids.claude', {
        defaultValue: catalogId,
      })
    : ''
  const HarnessIcon =
    (catalogId ? resolveSessionIconFromBrandKey(catalogId) : null)
    ?? resolveSessionIcon(provider, acpAgentId)

  if (worktreeRemoved) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-3 text-sm text-muted-foreground">
        <GitFork className="size-3.5 shrink-0" />
        <span>Worktree has been removed.</span>
        <span>This session is now <em>READ ONLY</em>.</span>
      </div>
    )
  }
  // Disabled harness keeps its binary on disk (re-enable is instant) but must
  // not accept new turns — same composer withdrawal as worktree-removed. Main
  // process also refuses to resolve a disabled runtime, so mobile/automation
  // cannot bypass this banner.
  if (harnessDisabled && catalogId) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-3 text-sm text-muted-foreground">
        {HarnessIcon ? (
          <span className="inline-flex shrink-0">
            <HarnessIcon status="default" size={18} renderLevel="compact" />
          </span>
        ) : null}
        <span>
          <span className="font-medium text-foreground">{harnessLabel}</span>
          {' '}is disabled.
        </span>
        <span>This session is now <em>READ ONLY</em>.</span>
        <button
          type="button"
          onClick={() => openHarnessSettings(catalogId)}
          className="text-foreground underline underline-offset-2 hover:opacity-80"
        >
          Re-enable {harnessLabel}
        </button>
      </div>
    )
  }
  if (isRemoteLocked) {
    if (remoteDraftId) return <>
      <RemoteComposerBanner busy={disconnectingDraft} onDisconnect={() => {
        setDisconnectingDraft(true)
        void window.environment.disconnectDraft('local', remoteDraftId)
          .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not disconnect draft'))
          .finally(() => setDisconnectingDraft(false))
      }} />
      <ChatInput />
      <div inert className="opacity-60"><ChatStatusBar /></div>
    </>
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-3 text-sm text-muted-foreground">
        <Smartphone className="size-3.5 shrink-0" />
        <span>Remote session active — observation mode.</span>
        <button
          onClick={disconnectRemoteSessionAction}
          className="text-foreground underline underline-offset-2 hover:opacity-80"
        >
          Disconnect
        </button>
      </div>
    )
  }
  return (
    <>
      <SessionDecisionPrompts />
      <CursorApiKeyDialog />
      {showTodoPopup && <TodoPopup />}
      <ChatInput />
      <ChatStatusBar />
    </>
  )
})
