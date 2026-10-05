import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, FileText, Maximize2, UnfoldVertical } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { ChipHoverCard } from './ChipHoverCard'
import { MentionChipContent } from './MentionChip'
import { PasteChipPreview } from './PasteChipPreview'
import { useCopyText } from './chat-message/copy-button'
import { cn } from '@superone/ui/lib/utils'

const SUMMARY_CHARS = 40
const EXCERPT_LINES = 10

/** The chip label: the text's start on one line, whitespace collapsed. */
export function pasteSummary(text: string): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  return chars.length > SUMMARY_CHARS ? `${chars.slice(0, SUMMARY_CHARS).join('')}…` : chars.join('')
}

function pasteExcerpt(text: string): string {
  const lines = text.split('\n')
  return lines.length > EXCERPT_LINES ? `${lines.slice(0, EXCERPT_LINES).join('\n')}\n…` : text
}

/**
 * Long pasted text as an inline chip, in the composer and in a sent bubble.
 * Click opens the full text; hover shows a longer excerpt and the actions.
 * `onSave` makes the full-text dialog editable; `onExpand` turns the chip back
 * into plain text (composer only). `selectable` lets a sent bubble's selection
 * take the chip; copying it yields the full text (utils/selection-copy.ts).
 */
export function PasteChip({ text, onSave, onExpand, selectable }: {
  text: string
  onSave?: (text: string) => void
  onExpand?: () => void
  selectable?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { copied, copy } = useCopyText()

  const actions = (
    <>
      {onExpand && (
        <IconButton tooltip={t('tooltips.expandToPlainText')} onClick={onExpand}>
          <UnfoldVertical />
        </IconButton>
      )}
      <IconButton tooltip={onSave ? t('chat.pasteChip.viewEdit') : t('chat.pasteChip.view')} onClick={() => setOpen(true)}>
        <Maximize2 />
      </IconButton>
      <IconButton tooltip={t('chat.pasteChip.copy')} onClick={() => void copy(text)}>
        {copied ? <Check className="text-success" /> : <Copy />}
      </IconButton>
    </>
  )

  return (
    <>
      <ChipHoverCard
        title={t('chat.pasteChip.title', { count: text.split('\n').length })}
        actions={actions}
        card={(
          <pre className="max-h-48 overflow-hidden whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-muted-foreground">
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
      </ChipHoverCard>
      <PasteChipPreview open={open} onOpenChange={setOpen} text={text} onSave={onSave} />
    </>
  )
}
