import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitFork, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { useChatStore, useActiveSession, useIsRemoteLocked, useRemoteControlReleased, useSessionRemoteController } from '@/stores/chat'
import { useSessionScope } from '@/stores/chat-store/session-scope'
import { applyRemoteControlChange } from '@/stores/chat-store/helpers/remote-control'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { useAppStore } from '@/stores/app'
import { catalogIdForSessionProvider, isCatalogHarnessDisabled } from '@/lib/harness-visibility'
import { resolveSessionIcon, resolveSessionIconFromBrandKey } from '@/components/harness/resolve-session-icon'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'
import { ChatInput } from './ChatInput'
import { ChatStatusBar } from './ChatStatusBar'
import { RemoteComposerBanner } from './RemoteComposerBanner'
import { RemoteControlBanner } from './RemoteControllerBanner'
import { CursorApiKeyDialog } from './CursorApiKeyDialog'
import { TodoPopup } from './TodoPopup'

/**
 * Composer stack — owns NO messages subscription. Stream ticks that only update
 * transcript text should not re-render TipTap / status chrome.
 */
export const ChatComposerShell = memo(function ChatComposerShell({
  showTodoPopup,
  autoFocusOnMount = true,
  onMounted,
}: {
  showTodoPopup: boolean
  autoFocusOnMount?: boolean
  onMounted?: () => void
}) {
  const { t } = useTranslation()
  const worktreeRemoved = useActiveSession((s) => s._worktreeRemoved)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const acpAgentId = useActiveSession((s) => s.acpAgentId)
  const disconnectRemoteSessionAction = useChatStore((s) => s.disconnectRemoteSession)
  const isRemoteLocked = useIsRemoteLocked()
  const remoteController = useSessionRemoteController()
  const remoteControlReleased = useRemoteControlReleased()
  const scope = useSessionScope()
  const projectPath = useChatStore((s) => scope?.projectPath ?? s.activeProject)
  const [controlBusy, setControlBusy] = useState(false)
  /** Connection of the computer that took this session back; null while this pane may drive it. */
  const releasedOn = remoteControlReleased && projectPath ? parseRemoteProjectKey(projectPath)?.connectionId ?? null : null
  const hostLabel = useEnvironmentLabel(releasedOn)
  /** The pane's session, read when acted on so an unscoped pane does not follow every switch. */
  const sessionId = (): string | null => scope?.sessionId
    ?? (projectPath ? useChatStore.getState().projectSessions[projectPath]?._activeSessionId ?? null : null)
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
  /** Disconnect or Reconnect; the toast names which one failed. */
  const changeControl = (action: 'disconnect' | 'reconnect', change: (sid: string) => Promise<unknown>) => {
    const sid = sessionId()
    if (!sid) return
    setControlBusy(true)
    void change(sid)
      .catch((error) => toast.error(t(`chat.remoteController.${action}Failed`, { message: error instanceof Error ? error.message : String(error) })))
      .finally(() => setControlBusy(false))
  }
  if (remoteController) {
    // The session announces the change, which reopens the composer here.
    return <RemoteControlBanner label={remoteController.label} action="disconnect" busy={controlBusy}
      onAction={() => changeControl('disconnect', (sid) => window.app.releaseNodeHostSession(sid))} />
  }
  if (releasedOn && projectPath) {
    return <RemoteControlBanner label={hostLabel} action="reconnect" busy={controlBusy}
      onAction={() => changeControl('reconnect', (sid) => window.environment.reclaimSessionControl(releasedOn, sid)
        .then(() => useChatStore.setState((s) => applyRemoteControlChange(s, projectPath, sid, false))))} />
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
      <CursorApiKeyDialog />
      {showTodoPopup && <TodoPopup />}
      <ChatInput autoFocusOnMount={autoFocusOnMount} onMounted={onMounted} />
      <ChatStatusBar />
    </>
  )
})

/** A paired computer's name, read once it is needed; null until known. */
function useEnvironmentLabel(connectionId: string | null): string | null {
  const [label, setLabel] = useState<string | null>(null)
  useEffect(() => {
    if (!connectionId) return
    let cancelled = false
    void window.environment.listItems()
      .then((items) => { if (!cancelled) setLabel(items.find((item) => item.connectionId === connectionId)?.label ?? null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [connectionId])
  return connectionId ? label : null
}
