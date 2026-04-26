import { useState } from 'react'
import { Quote, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface UserSelectionChipProps {
  selections: string[]
  onRemoveAt?: (index: number) => void
  onClear?: () => void
  readOnly?: boolean
}

function previewOf(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

export function UserSelectionChip({ selections, onRemoveAt, onClear, readOnly = false }: UserSelectionChipProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (selections.length === 0) return null

  const isMulti = selections.length > 1
  const label = isMulti
    ? t('chat.userSelectionChip.title', { count: selections.length })
    : previewOf(selections[0])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          className="group inline-flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1 text-sm text-foreground/85 whitespace-nowrap select-none cursor-pointer transition-colors hover:bg-background/70 hover:text-foreground"
        >
          <Quote className="size-2.5 shrink-0 text-primary/50 transition-colors group-hover:text-primary/80" />
          <button
            type="button"
            className="max-w-[220px] truncate cursor-pointer"
            onClick={() => setOpen((o) => !o)}
          >
            {label}
          </button>
          {!readOnly && onClear && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onClear()
              }}
              className="ml-0.5 cursor-pointer text-muted-foreground/70 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-96 p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Quote className="size-2.5 text-primary/50" />
          <span>{t('chat.userSelectionChip.popoverTitle', { count: selections.length })}</span>
        </div>
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {selections.map((text, i) => (
            <div
              key={i}
              className="group/quote relative rounded-md bg-muted p-2.5 pr-7 font-mono text-xs leading-relaxed text-muted-foreground"
            >
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap">{text}</pre>
              {!readOnly && onRemoveAt && (
                <button
                  type="button"
                  onClick={() => onRemoveAt(i)}
                  className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover/quote:opacity-100"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
