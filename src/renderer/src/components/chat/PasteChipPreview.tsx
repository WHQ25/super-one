import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Check, Copy, Save, X } from 'lucide-react'

interface PasteChipPreviewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  text: string
  onSave?: (text: string) => void
}

export function PasteChipPreview({ open, onOpenChange, text, onSave }: PasteChipPreviewProps) {
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
            Pasted text · {draftLineCount} {draftLineCount === 1 ? 'line' : 'lines'}
            {dirty && <span className="ml-2 text-xs font-normal text-muted-foreground">(unsaved)</span>}
          </DialogTitle>
          <div className="flex items-center gap-1">
            {onSave && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-40"
                onClick={handleSave}
                disabled={!dirty}
                title="Save (⌘/Ctrl+Enter)"
              >
                <Save className="size-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={handleCopy}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
            <DialogClose asChild>
              <Button variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </Button>
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
