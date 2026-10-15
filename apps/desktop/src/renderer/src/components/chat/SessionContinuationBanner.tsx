import { useTranslation } from 'react-i18next'
import { ArrowRight, History } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { useChatStore } from '@/stores/chat-store'
import { useSessionScope } from '@/stores/chat-store/session-scope'
import { useActiveSession } from '@/stores/chat-store/selectors'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'

/**
 * The row above the composer of a session already continued in a new one
 * (docs/features/session-continuation.md); the offer itself is a composer.
 */
export function SessionContinuedNotice({ onOpen }: { onOpen(): void }) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      data-testid="session-continued-notice"
      className="mx-3 mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <span className="flex min-w-0 flex-1 basis-56 items-center gap-1.5">
        <History className="size-3.5 shrink-0" aria-hidden />
        <span>{t('chat.sessionContinuation.continuedIn')}</span>
      </span>
      <Button size="xs" variant="secondary" onClick={onOpen}>
        {t('chat.sessionContinuation.openSuccessor')}
        <ArrowRight aria-hidden />
      </Button>
    </div>
  )
}

/** The continued-in row for the composer's session, when it has a successor. */
export function SessionContinuationBanner() {
  const scope = useSessionScope()
  const projectPath = useChatStore((s) => scope?.projectPath ?? s.activeProject)
  const continuedIn = useActiveSession((s) => s._continuedIn ?? null)
  if (!projectPath || !continuedIn) return null
  return (
    <SessionContinuedNotice
      onOpen={() => {
        void useChatStore.getState().switchToSession(projectPath, continuedIn)
        useMosaicStore.getState().focusOrReplaceFocused(projectPath, continuedIn)
      }}
    />
  )
}
