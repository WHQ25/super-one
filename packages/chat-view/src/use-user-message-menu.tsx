import { useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Pencil } from 'lucide-react'
import type { ChatMessage } from '@superone/shared/agent-types'
import { requestNative } from './bridge'
import { useLongPress } from './long-press'
import { PortableMessageMenu } from './PortableMessageMenu'
import { userMessageCopyText } from './user-message-copy-text'

/** How long the "Copied" confirmation stays before the menu folds away. */
const COPIED_LINGER_MS = 700

/**
 * Long-press affordance for a user bubble: arms the gesture, asks the shell for
 * a haptic tick the moment it fires, and owns the floating menu's open state.
 * Returns nothing to spread when the message is not a user's or has no text,
 * so a bubble without a copyable body never pretends to have a menu.
 */
export function useUserMessageMenu(
  message: ChatMessage,
  { enabled, align }: { enabled: boolean; align: 'start' | 'end' },
): { bubbleProps?: HTMLAttributes<HTMLDivElement>; menu?: ReactNode } {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyText = useMemo(() => (enabled ? userMessageCopyText(message) : ''), [enabled, message])
  const active = enabled && copyText.length > 0

  const close = useCallback(() => {
    if (closeTimer.current != null) clearTimeout(closeTimer.current)
    closeTimer.current = null
    setOpen(false)
    setCopied(false)
  }, [])
  useEffect(() => () => { if (closeTimer.current != null) clearTimeout(closeTimer.current) }, [])

  const handlers = useLongPress(() => {
    if (!active) return
    // Fire-and-forget: the shell answers with a Taptic tick; nothing waits on it.
    requestNative('haptic', { style: 'medium' })
    setOpen(true)
  })

  if (!active) return {}

  const copy = () => {
    requestNative('copyText', { text: copyText })
    setCopied(true)
    closeTimer.current = setTimeout(close, COPIED_LINGER_MS)
  }

  return {
    bubbleProps: handlers,
    menu: open
      ? (
        <PortableMessageMenu
          align={align}
          onClose={close}
          items={[{
            id: 'copy',
            icon: copied ? <Check className="text-success" /> : <Copy />,
            label: copied ? t('chat.messageMenu.copied') : t('chat.messageMenu.copy'),
            onSelect: copied ? close : copy,
          },
          // The phone has no hover row; editing a send the host never took lives here.
          ...(message.metadata?.sendFailure
            ? [{
                id: 'edit',
                icon: <Pencil />,
                label: t('chat.sendFailure.edit'),
                onSelect: () => {
                  requestNative('editFailedMessage', { messageId: message.id })
                  close()
                },
              }]
            : [])]}
        />
      )
      : undefined,
  }
}
