import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Expand } from 'lucide-react'
import { extractTableDataFromElement, tableDataToMarkdown } from 'streamdown'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { tryCopy } from '@/lib/clipboard'
import { FullscreenGlassDialog } from './FullscreenGlassDialog'

function TableFullscreen({ open, onOpenChange, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <FullscreenGlassDialog open={open} onOpenChange={onOpenChange} title="Table">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-end gap-1 px-4 py-2 text-xs text-muted-foreground/70">
          <Kbd>esc</Kbd> exit
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
  const [copied, setCopied] = useState(false)
  const tableRef = useRef<HTMLTableElement>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  async function handleCopy() {
    if (!tableRef.current) return
    const markdown = tableDataToMarkdown(extractTableDataFromElement(tableRef.current))
    if (!(await tryCopy(markdown))) return
    setCopied(true)
    clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex justify-center">
      <div data-streamdown="table-wrapper" className="group/mdtable relative w-full min-w-0">
        <div data-table-toolbar className="absolute right-0 top-0 flex items-center gap-1 opacity-0 transition-opacity group-hover/mdtable:opacity-100 group-focus-within/mdtable:opacity-100 [@media(hover:none)]:opacity-100">
          <IconButton
            size="xs"
            variant="ghost"
            onClick={handleCopy}
            className="opacity-50 transition-opacity hover:opacity-100"
            tooltip={t('tooltips.copyTable')}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </IconButton>
          <IconButton
            size="xs"
            variant="ghost"
            onClick={() => setOpen(true)}
            className="opacity-50 transition-opacity hover:opacity-100"
            tooltip={t('tooltips.expand')}
          >
            <Expand className="size-3" />
          </IconButton>
        </div>
        <div className="overflow-x-auto pt-5">
          <table data-streamdown="table" {...rest} ref={tableRef}>{children}</table>
        </div>
        <TableFullscreen open={open} onOpenChange={setOpen}>{children}</TableFullscreen>
      </div>
    </div>
  )
}
