import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, FileText, Maximize2, X } from 'lucide-react'
import { pasteExcerpt, pasteSummary } from '@superone/shared/user-message-parts'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@superone/ui/components/ui/dialog'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { MentionChipContent } from '@superone/ui/components/ui/MentionChipBody'
import { cn } from '@superone/ui/lib/utils'
import { PASTE_TEXT_DIALOG, PASTE_TEXT_EDITOR } from '@superone/ui/lib/paste-chip-presentation'
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
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0"
        style={{ maxHeight: `${PASTE_TEXT_DIALOG.maxHeightRatio * 100}vh`, maxWidth: PASTE_TEXT_DIALOG.maxWidth, width: `calc(100% - ${PASTE_TEXT_DIALOG.viewportMargin * 2}px)`, borderRadius: PASTE_TEXT_DIALOG.radius }}>
        <div className="flex items-center justify-between border-b" style={{ padding: `${PASTE_TEXT_DIALOG.headerPaddingVertical}px ${PASTE_TEXT_DIALOG.headerPaddingHorizontal}px` }}>
          <DialogTitle className="font-medium" style={{ fontSize: PASTE_TEXT_DIALOG.titleFontSize, lineHeight: `${PASTE_TEXT_DIALOG.titleLineHeight}px` }}>
            {t('chat.pasteChip.title', { count: lineCount ?? text.split('\n').length })}
            {titleExtra}
          </DialogTitle>
          <div className="flex items-center" style={{ gap: PASTE_TEXT_DIALOG.actionGap }}>
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
          <pre className="overflow-auto whitespace-pre-wrap font-mono text-foreground" style={{ ...PASTE_TEXT_EDITOR, lineHeight: `${PASTE_TEXT_EDITOR.lineHeight}px`, maxHeight: `${PASTE_TEXT_DIALOG.editorHeightRatio * 100}vh` }}>
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
