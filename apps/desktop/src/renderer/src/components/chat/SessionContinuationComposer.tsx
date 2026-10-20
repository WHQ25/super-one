import { useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AtSign, Forward, Network, type LucideIcon } from 'lucide-react'
import { continueInNewSession } from '@/lib/session-continuation'
import { PermissionActionButton } from './PermissionActionBar'
import { isFocusInChat, useChatRootRef } from './is-focus-in-chat'
import { claimDecisionFocus, setDecisionKeyboardPolicy, shouldSuppressDecisionShortcut } from './composer-slot/decision-composer-policy'
import { dismissContinuationOffer, type SessionContinuationOffer } from './session-continuation-offer'

const BENEFITS: Array<{ icon: LucideIcon; key: 'mentionsThis' | 'collaborationKept' }> = [
  { icon: AtSign, key: 'mentionsThis' },
  { icon: Network, key: 'collaborationKept' },
]

/**
 * The handoff a long session whose prompt cache expired offers in place of the
 * text composer (docs/features/session-continuation.md). Enter approves and
 * Escape dismisses while focus is in this pane.
 */
export function SessionHandoffPrompt({ onApprove, onDismiss, shortcutKey }: {
  onApprove(): void
  onDismiss(): void
  /** Identifies this offer for the accidental-Enter guard; omit outside a chat pane. */
  shortcutKey?: string
}) {
  const { t } = useTranslation()
  const chatRootRef = useChatRootRef()
  const containerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = chatRootRef?.current
    if (!root || !shortcutKey) return
    return setDecisionKeyboardPolicy(root, shortcutKey)
  }, [chatRootRef, shortcutKey])

  // The editor this replaced took focus with it; keep the pane's shortcuts alive.
  useEffect(() => { claimDecisionFocus(containerRef.current, chatRootRef?.current) }, [chatRootRef, shortcutKey])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || !isFocusInChat(document.activeElement, chatRootRef?.current)) return
      if (shouldSuppressDecisionShortcut(event, chatRootRef?.current)) return
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onApprove() }
      else if (event.key === 'Escape') { event.preventDefault(); onDismiss() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chatRootRef, onApprove, onDismiss])

  return (
    <div ref={containerRef} tabIndex={-1} data-decision-focus="" data-testid="session-handoff-prompt" className="mx-3 mb-1 outline-none">
      <div className="rounded-xl border border-border bg-card px-3.5 py-3 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
            <Forward className="size-4 text-primary" aria-hidden />
          </div>
          <h3 className="min-w-0 text-sm font-semibold text-foreground">{t('chat.sessionContinuation.title')}</h3>
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{t('chat.sessionContinuation.lead')}</p>
        <ul className="mt-2 space-y-1.5">
          {BENEFITS.map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-start gap-2 text-xs leading-relaxed text-foreground">
              <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span>{t(`chat.sessionContinuation.${key}`)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 grid max-w-sm grid-cols-2 gap-2">
          <PermissionActionButton tone="primary" kbd="⏎" onClick={onApprove}>
            {t('chat.sessionContinuation.approve')}
          </PermissionActionButton>
          <PermissionActionButton tone="neutral" kbd="esc" onClick={onDismiss}>
            {t('chat.sessionContinuation.dismiss')}
          </PermissionActionButton>
        </div>
      </div>
    </div>
  )
}

/** The composer-slot entry for `offer`. */
export function SessionContinuationComposer({ offer }: { offer: SessionContinuationOffer }) {
  return (
    <SessionHandoffPrompt
      shortcutKey={`continuation:${offer.sessionId}:${offer.expiresAt}`}
      onApprove={() => { continueInNewSession(offer.projectPath, offer.sessionId) }}
      onDismiss={() => dismissContinuationOffer(offer)}
    />
  )
}
