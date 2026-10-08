import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Fragment, Slice } from '@tiptap/pm/model'
import { useTranslation } from 'react-i18next'
import { UnfoldVertical } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { PasteChipPresenter } from '@superone/chat-view/presenters/PasteChip'
import { PasteChipPreview } from './PasteChipPreview'

export function PasteChipView({ node, getPos, editor }: NodeViewProps) {
  const { t } = useTranslation()
  const { text } = node.attrs as { text: string }

  // Open the slice on both sides so the first line joins the text before the
  // chip and the last line the text after it, as if typed in place.
  const handleExpand = (): void => {
    const pos = getPos()
    if (pos == null) return
    const { schema } = editor
    const lines = text.split('\n').map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : null))
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.replace(pos, pos + node.nodeSize, new Slice(Fragment.from(lines), 1, 1))
        return true
      })
      .run()
  }

  const handleSave = (nextText: string): void => {
    const pos = getPos()
    if (pos == null) return
    editor
      .chain()
      .command(({ tr }) => {
        tr.setNodeMarkup(pos, null, { text: nextText })
        return true
      })
      .run()
  }

  return (
    <NodeViewWrapper as="span" contentEditable={false} data-paste-chip="" className="select-none">
      <PasteChipPresenter
        text={text}
        actions={(
          <IconButton tooltip={t('tooltips.expandToPlainText')} onClick={handleExpand}>
            <UnfoldVertical />
          </IconButton>
        )}
        dialog={(open, onOpenChange) => <PasteChipPreview open={open} onOpenChange={onOpenChange} text={text} onSave={handleSave} />}
      />
    </NodeViewWrapper>
  )
}
