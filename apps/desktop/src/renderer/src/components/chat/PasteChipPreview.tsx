import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Save } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { PasteTextDialog } from '@superone/chat-view/presenters/PasteChip'

/** A composer paste chip's full text, editable; ⌘/Ctrl+Enter saves it back into the chip. */
export function PasteChipPreview({ open, onOpenChange, text, onSave }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  text: string
  onSave: (text: string) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(text)

  useEffect(() => {
    if (open) setDraft(text)
  }, [open, text])

  const dirty = draft !== text

  const handleSave = useCallback(() => {
    if (!dirty) return
    onSave(draft)
    onOpenChange(false)
  }, [onSave, dirty, draft, onOpenChange])

  return (
    <PasteTextDialog
      open={open}
      onOpenChange={onOpenChange}
      text={draft}
      titleExtra={dirty && <span className="ml-2 text-xs font-normal text-muted-foreground">{t('chat.pasteChip.unsaved')}</span>}
      actions={(
        <IconButton
          size="sm"
          className="disabled:opacity-40"
          onClick={handleSave}
          disabled={!dirty}
          tooltip={t('tooltips.save', { shortcut: '⌘/Ctrl+Enter' })}
        >
          <Save />
        </IconButton>
      )}
    >
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            handleSave()
          }
        }}
        spellCheck={false}
        className="block h-[60vh] w-full resize-none border-0 bg-transparent p-4 font-mono text-xs leading-relaxed text-foreground outline-none focus:outline-none focus-visible:outline-none"
      />
    </PasteTextDialog>
  )
}
