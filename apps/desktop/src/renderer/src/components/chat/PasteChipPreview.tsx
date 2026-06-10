import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@superone/ui/components/ui/dialog'
import { Check, Copy, Save, X } from 'lucide-react'

interface PasteChipPreviewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  text: string
  onSave?: (text: string) => void
}

export function PasteChipPreview({ open, onOpenChange, text, onSave }: PasteChipPreviewProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [draft, setDraft] = useState(text)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) setDraft(text)
  }, [open, text])

  const dirty = draft !== text
  const draftLineCount = draft.split('\n').length

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(draft)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [draft])

  const handleSave = useCallback(() => {
    if (!onSave || !dirty) return
    onSave(draft)
    onOpenChange(false)
  }, [onSave, dirty, draft, onOpenChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        handleSave()
      }
    },
    [handleSave]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] max-w-4xl gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <DialogTitle className="text-sm font-medium">
            {t('chat.pasteChip.title', { count: draftLineCount })}
            {dirty && <span className="ml-2 text-xs font-normal text-muted-foreground">{t('chat.pasteChip.unsaved')}</span>}
          </DialogTitle>
          <div className="flex items-center gap-1">
            {onSave && (
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
            <IconButton size="sm" onClick={handleCopy}>
              {copied ? <Check /> : <Copy />}
            </IconButton>
            <DialogClose asChild>
              <IconButton size="sm">
                <X />
              </IconButton>
            </DialogClose>
          </div>
        </div>
        {onSave ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            className="block h-[60vh] w-full resize-none border-0 bg-transparent p-4 font-mono text-xs leading-relaxed text-foreground outline-none focus:outline-none focus-visible:outline-none"
          />
        ) : (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-foreground">
            {text}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  )
}
