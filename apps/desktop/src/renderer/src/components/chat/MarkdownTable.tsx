import { useState, type ComponentProps, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Expand, X } from 'lucide-react'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { FullscreenGlassDialog } from './FullscreenGlassDialog'

function TableFullscreen({ open, onOpenChange, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <FullscreenGlassDialog open={open} onOpenChange={onOpenChange} title="Table">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-end gap-2 px-4 py-2 text-[10px] text-muted-foreground/70">
          <Kbd>esc</Kbd> exit
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={t('common.close')}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="md-table-full flex-1 overflow-auto">
          <div className="flex min-h-full min-w-full items-center justify-center p-4 pt-0">
            <table data-streamdown="table">{children}</table>
          </div>
        </div>
      </div>
    </FullscreenGlassDialog>
  )
}

export function MarkdownTable({ node: _node, children, ...rest }: ComponentProps<'table'> & { node?: unknown }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div data-streamdown="table-wrapper" className="group/mdtable relative">
      <div className="overflow-x-auto">
        <table data-streamdown="table" {...rest}>{children}</table>
      </div>
      <button
        onClick={() => setOpen(true)}
        className="absolute right-1.5 top-1.5 z-10 rounded bg-background/80 p-1 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-opacity hover:text-foreground group-hover/mdtable:opacity-100"
        title={t('tooltips.expand')}
      >
        <Expand className="size-3.5" />
      </button>
      <TableFullscreen open={open} onOpenChange={setOpen}>{children}</TableFullscreen>
    </div>
  )
}
