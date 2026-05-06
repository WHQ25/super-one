import { useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { FileText, UnfoldVertical, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { PasteChipPreview } from './PasteChipPreview'

export function PasteChipView({ node, getPos, editor, selected }: NodeViewProps) {
  const { t } = useTranslation()
  const { text, lineCount, preview } = node.attrs as { text: string; lineCount: number; preview: string }
  const [previewOpen, setPreviewOpen] = useState(false)

  const handleRemove = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const pos = getPos()
    if (pos != null) {
      editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
    }
  }

  const handleExpand = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const pos = getPos()
    if (pos == null) return
    const content = text.split('\n').map((line) =>
      line
        ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
        : { type: 'paragraph' }
    )
    editor
      .chain()
      .focus()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, content)
      .run()
  }

  const handleSave = (nextText: string) => {
    const pos = getPos()
    if (pos == null) return
    const nextLineCount = nextText.split('\n').length
    const nextPreview = nextText.slice(0, 60).replace(/\n/g, ' ')
    editor
      .chain()
      .command(({ tr }) => {
        tr.setNodeMarkup(pos, null, { text: nextText, lineCount: nextLineCount, preview: nextPreview })
        return true
      })
      .run()
  }

  return (
    <NodeViewWrapper
      as="div"
      contentEditable={false}
      data-paste-chip=""
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm text-foreground select-none transition-colors',
        selected
          ? 'border-primary/50 bg-primary/10 ring-1 ring-primary/30'
          : 'border-border bg-muted/50 hover:bg-muted'
      )}
    >
      <div
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
        onClick={() => setPreviewOpen(true)}
      >
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-muted-foreground">{preview}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{lineCount} lines</span>
      </div>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onMouseDown={handleExpand}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              contentEditable={false}
            >
              <UnfoldVertical className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span>{t('tooltips.expandToPlainText')}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <button
        onMouseDown={handleRemove}
        className="shrink-0 text-muted-foreground hover:text-foreground"
        contentEditable={false}
      >
        <X className="size-3.5" />
      </button>
      <PasteChipPreview open={previewOpen} onOpenChange={setPreviewOpen} text={text} onSave={handleSave} />
    </NodeViewWrapper>
  )
}
