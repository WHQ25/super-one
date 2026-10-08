import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, FileText, Maximize2, X } from 'lucide-react'
import { pasteExcerpt, pasteSummary } from '@superone/shared/user-message-parts'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@superone/ui/components/ui/dialog'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { MentionChipContent } from '@superone/ui/components/ui/MentionChipBody'
import { cn } from '@superone/ui/lib/utils'
import { useUserBubblePorts } from './user-bubble-ports'

/** `copied` flips on for a moment after a copy through the host succeeds. */
export function useCopiedFlag(): { copied: boolean; run: (copy: () => Promise<boolean>) => Promise<void> } {
  const [copied, setCopied] = useState(false)
  const run = async (copy: () => Promise<boolean>) => {
    if (!(await copy())) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return { copied, run }
}

/**
 * A pasted text in full. Read-only by default; the composer passes its editor
 * as `children`, its save action in `actions` and its dirty mark in `titleExtra`.
 */
export function PasteTextDialog({ open, onOpenChange, text, lineCount, titleExtra, actions, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What the copy button copies: the text, or the composer's draft of it. */
  text: string
  lineCount?: number
  titleExtra?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const { copyText } = useUserBubblePorts()
  const { copied, run } = useCopiedFlag()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] max-w-4xl gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <DialogTitle className="text-sm font-medium">
            {t('chat.pasteChip.title', { count: lineCount ?? text.split('\n').length })}
            {titleExtra}
          </DialogTitle>
          <div className="flex items-center gap-1">
            {actions}
            <IconButton size="sm" onClick={() => void run(() => copyText(text))}>
              {copied ? <Check /> : <Copy />}
            </IconButton>
            <DialogClose asChild>
              <IconButton size="sm">
                <X />
              </IconButton>
            </DialogClose>
          </div>
        </div>
        {children ?? (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-foreground">
            {text}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Long pasted text as an inline chip, in the composer and in a sent bubble.
 * Tap or click opens the full text; where the host has hover, a card shows a
 * longer excerpt and the actions. The composer adds its own `actions` and an
 * editable `dialog`. `selectable` lets a sent bubble's selection take the chip;
 * copying it yields the full text.
 */
export function PasteChipPresenter({ text, selectable, actions, dialog }: {
  text: string
  selectable?: boolean
  actions?: ReactNode
  dialog?: (open: boolean, onOpenChange: (open: boolean) => void) => ReactNode
}) {
  const { t } = useTranslation()
  const { ChipCard, copyText } = useUserBubblePorts()
  const [open, setOpen] = useState(false)
  const { copied, run } = useCopiedFlag()
  return (
    <>
      <ChipCard
        title={t('chat.pasteChip.title', { count: text.split('\n').length })}
        actions={(
          <>
            {actions}
            <IconButton tooltip={dialog ? t('chat.pasteChip.viewEdit') : t('chat.pasteChip.view')} onClick={() => setOpen(true)}>
              <Maximize2 />
            </IconButton>
            <IconButton tooltip={t('chat.pasteChip.copy')} onClick={() => void run(() => copyText(text))}>
              {copied ? <Check className="text-success" /> : <Copy />}
            </IconButton>
          </>
        )}
        card={(
          <pre className="max-h-48 overflow-hidden whitespace-pre-wrap break-words font-mono text-[0.6875rem] leading-4 text-muted-foreground">
            {pasteExcerpt(text)}
          </pre>
        )}
      >
        <MentionChipContent
          role="button"
          kind="paste"
          className={cn('break-normal cursor-pointer', selectable && 'select-text')}
          // Pasted text is its own content block: keep it on its own lines.
          data-copy-text={`\n${text}\n`}
          data-copy-paste=""
          onClick={() => setOpen(true)}
          icon={<FileText />}
          label={pasteSummary(text)}
        />
      </ChipCard>
      {dialog ? dialog(open, setOpen) : <PasteTextDialog open={open} onOpenChange={setOpen} text={text} />}
    </>
  )
}
