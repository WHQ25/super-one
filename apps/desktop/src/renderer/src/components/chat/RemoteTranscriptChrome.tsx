import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { pageRemoteTranscript } from '@/lib/remote-session-ops'
import { useChatStore, useSessionScope } from '@/stores/chat'
import { patchRemoteSession, setTranscriptFlag } from '@/stores/chat-store/helpers/remote-reconnect'
import { cn } from '@superone/ui/lib/utils'

/** Which end of the transcript this chrome belongs to. */
export type RemoteTranscriptEdge = 'top' | 'bottom'

export interface RemoteTranscriptChromeViewProps {
  edge?: RemoteTranscriptEdge
  summarized?: boolean
  paging?: boolean
  resyncing?: boolean
  hasOlder?: boolean
  hasNewer?: boolean
  onLoadEarlier?: () => void
  onLoadNewer?: () => void
}

/**
 * Window controls for a remote transcript: earlier and newer pages, a note
 * when bodies are summarized, and the line shown while a page or a resync
 * is in flight. Renders nothing for a local session or a legacy full load.
 */
export function RemoteTranscriptChromeView({
  edge = 'top',
  summarized = false,
  paging = false,
  resyncing = false,
  hasOlder = false,
  hasNewer = false,
  onLoadEarlier,
  onLoadNewer,
}: RemoteTranscriptChromeViewProps) {
  const { t } = useTranslation()
  const busy = paging || resyncing
  const earlier = edge === 'top' && hasOlder
  const newer = edge === 'bottom' && hasNewer
  const note = edge === 'top' && (summarized || paging || resyncing)
  if (!earlier && !newer && !note) return null
  return (
    <div data-testid={`remote-transcript-chrome-${edge}`} className="flex flex-col gap-1">
      {earlier && (
        <button
          type="button"
          onClick={onLoadEarlier}
          disabled={busy || !onLoadEarlier}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-md px-3 py-1.5',
            'text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60',
          )}
        >
          {paging ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
          {t('chat.transcriptWindow.loadEarlier')}
        </button>
      )}
      {edge === 'top' && resyncing && (
        <p role="status" className="flex items-center justify-center gap-1.5 px-3 py-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          {t('chat.transcriptWindow.resyncing')}
        </p>
      )}
      {edge === 'top' && paging && (
        <p role="status" className="flex items-center justify-center gap-1.5 px-3 py-1 text-xs text-muted-foreground">
          {resyncing ? null : <Loader2 className="size-3 animate-spin" aria-hidden />}
          {t('chat.transcriptWindow.paging')}
        </p>
      )}
      {edge === 'top' && summarized && (
        <p className="px-3 py-1 text-center text-xs text-muted-foreground">
          {t('chat.transcriptWindow.summarized')}
        </p>
      )}
      {newer && (
        <button
          type="button"
          onClick={onLoadNewer}
          disabled={busy || !onLoadNewer}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-md px-3 py-1.5',
            'text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60',
          )}
        >
          {t('chat.transcriptWindow.loadNewer')}
        </button>
      )}
    </div>
  )
}

/** Store-backed window chrome. One instance per transcript edge. */
export function RemoteTranscriptChrome({ edge = 'top' }: { edge?: RemoteTranscriptEdge }) {
  const scope = useSessionScope()
  const model = useChatStore(useShallow((s) => {
    const projectPath = scope?.projectPath ?? s.activeProject
    const remote = projectPath ? parseRemoteProjectKey(projectPath) : null
    if (!remote || !projectPath) return null
    const sessionId = scope?.sessionId ?? s.projectSessions[projectPath]?._activeSessionId ?? null
    if (!sessionId) return null
    const session = s.projectSessions[projectPath]?._sessions[sessionId]
    const window = session?.transcriptWindow ?? null
    const resyncing = session?.transcriptResyncing === true
    if (!window && !resyncing) return null
    return { projectPath, sessionId, window, resyncing, paging: session?.transcriptPaging === true }
  }))

  if (!model) return null
  const { projectPath, sessionId } = model
  const page = (direction: 'before' | 'after') => {
    const current = useChatStore.getState().projectSessions[projectPath]?._sessions[sessionId]
    const anchor = direction === 'before' ? current?.transcriptWindow?.older : current?.transcriptWindow?.newer
    if (!current || !anchor || current.transcriptPaging) return
    setTranscriptFlag(projectPath, sessionId, 'transcriptPaging', true, useChatStore.setState)
    void pageRemoteTranscript(projectPath, sessionId, current, { anchor, direction })
      .then((paged) => {
        if (paged) patchRemoteSession(projectPath, sessionId, (session) => ({ ...session, ...paged }), useChatStore.setState)
      })
      .catch((error) => {
        console.warn('[chat] transcript page failed:', error)
      })
      .finally(() => setTranscriptFlag(projectPath, sessionId, 'transcriptPaging', false, useChatStore.setState))
  }

  return (
    <RemoteTranscriptChromeView
      edge={edge}
      summarized={model.window?.summarized === true}
      paging={model.paging}
      resyncing={model.resyncing}
      hasOlder={model.window?.older != null}
      hasNewer={model.window?.newer != null}
      onLoadEarlier={() => page('before')}
      onLoadNewer={() => page('after')}
    />
  )
}
