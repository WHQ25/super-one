import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { ArrowRight, History } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { sessionCacheExpiresAt } from '@superone/shared/session-continuation'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat-store'
import { useSessionScope } from '@/stores/chat-store/session-scope'
import { useActiveSession } from '@/stores/chat-store/selectors'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { continueInNewSession } from '@/lib/session-continuation'

const linkClassName = 'whitespace-nowrap underline-offset-2 hover:text-foreground hover:underline'

/**
 * The row above the composer of a long session whose prompt cache expired
 * (`hint`), or of one already continued in a new session (`continued`).
 */
export function SessionContinuationNotice(props:
  | { kind: 'hint'; onContinue(): void; onContinueHere(): void; onDontShowAgain(): void }
  | { kind: 'continued'; onOpen(): void },
) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      data-testid="session-continuation-notice"
      className="mx-3 mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <span className="flex min-w-0 flex-1 basis-56 items-center gap-1.5">
        <History className="size-3.5 shrink-0" aria-hidden />
        <span>{t(props.kind === 'hint' ? 'chat.sessionContinuation.hint' : 'chat.sessionContinuation.continuedIn')}</span>
      </span>
      {props.kind === 'hint' ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button size="xs" variant="secondary" onClick={props.onContinue}>
            {t('chat.sessionContinuation.continueInNew')}
          </Button>
          <button type="button" className={linkClassName} onClick={props.onContinueHere}>
            {t('chat.sessionContinuation.continueHere')}
          </button>
          <button type="button" className={linkClassName} onClick={props.onDontShowAgain}>
            {t('chat.sessionContinuation.dontShowAgain')}
          </button>
        </span>
      ) : (
        <Button size="xs" variant="secondary" onClick={props.onOpen}>
          {t('chat.sessionContinuation.openSuccessor')}
          <ArrowRight aria-hidden />
        </Button>
      )}
    </div>
  )
}

/** "Continue Here" holds per session until its cache expires again (a later turn). */
const dismissedExpiry = new Map<string, number>()

/** The notice for the composer's session, when one applies. */
export function SessionContinuationBanner() {
  const scope = useSessionScope()
  const projectPath = useChatStore((s) => scope?.projectPath ?? s.activeProject)
  const { sessionId, messages, contextTokens, status, pending, continuedIn } = useActiveSession(useShallow((s) => ({
    sessionId: scope?.sessionId ?? s._activeSessionId,
    messages: s.messages,
    contextTokens: s.contextTokens,
    status: s.status,
    pending: s.hasPendingInteraction,
    continuedIn: s._continuedIn ?? null,
  })))
  const settings = useAppStore((s) => s.sessionContinuationHint)
  const setSettings = useAppStore((s) => s.setSessionContinuationHint)
  const expiresAt = useMemo(
    () => (continuedIn ? null : sessionCacheExpiresAt({ messages, contextTokens, settings })),
    [continuedIn, messages, contextTokens, settings],
  )
  const [now, setNow] = useState(() => Date.now())
  const [, setDismissals] = useState(0)
  useEffect(() => {
    if (expiresAt === null || expiresAt <= now) return
    // Re-render at the expiry instant; setTimeout caps a delay near 24.8 days.
    const timer = setTimeout(() => setNow(Date.now()), Math.min(expiresAt - now, 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [expiresAt, now])

  if (!projectPath || !sessionId) return null
  if (continuedIn) {
    return (
      <SessionContinuationNotice
        kind="continued"
        onOpen={() => {
          void useChatStore.getState().switchToSession(projectPath, continuedIn)
          useMosaicStore.getState().focusOrReplaceFocused(projectPath, continuedIn)
        }}
      />
    )
  }
  if (expiresAt === null || now < expiresAt || status !== 'idle' || pending) return null
  if (dismissedExpiry.get(sessionId) === expiresAt) return null
  return (
    <SessionContinuationNotice
      kind="hint"
      onContinue={() => { continueInNewSession(projectPath, sessionId) }}
      onContinueHere={() => {
        dismissedExpiry.set(sessionId, expiresAt)
        setDismissals((n) => n + 1)
      }}
      onDontShowAgain={() => { void setSettings({ enabled: false }) }}
    />
  )
}
