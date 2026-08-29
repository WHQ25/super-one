import { useTranslation } from 'react-i18next'
import { MessageCirclePlus } from 'lucide-react'

/**
 * Empty surface of a side chat.
 *
 * A side chat opens with no visible transcript by design — the agent carries the
 * parent's context, but replaying that conversation into a narrow panel would
 * bury the question the user opened it to ask. It must NOT fall through to
 * `ChatSuggestions`: that is the new-session surface, and its harness picker
 * switches the project's active session out from under the chat this panel is
 * docked beside.
 *
 * So this is also where the "temporary" warning belongs — the user reads it
 * before typing, not as a bar pinned above an otherwise normal chat.
 */
export function SideChatEmptyState() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <MessageCirclePlus className="size-6 text-muted-foreground/60" />
      <div className="text-sm font-medium">{t('sideChat.title')}</div>
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
        {t('sideChat.ephemeralNotice')}
      </p>
    </div>
  )
}
