import { useState } from 'react'
import { SquareDashedMousePointer, MousePointerClick, Paintbrush, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import type { BrowserAnnotation } from '@/stores/chat'

interface BrowserAnnotationChipsProps {
  annotations: BrowserAnnotation[]
  onRemove: (id: string) => void
  onClear: () => void
}

function labelOf(a: BrowserAnnotation, fallbackElement: string, fallbackRegion: string): string {
  if (a.kind === 'element') return a.selector ?? fallbackElement
  return fallbackRegion
}

export function BrowserAnnotationChips({ annotations, onRemove, onClear }: BrowserAnnotationChipsProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (annotations.length === 0) return null

  const isMulti = annotations.length > 1
  const first = annotations[0]
  const triggerLabel = isMulti
    ? t('chat.browser.annotationCount', { count: annotations.length })
    : first.comment.trim() || labelOf(first, t('chat.browser.annotateElement'), t('chat.browser.annotateRegion'))

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="group inline-flex max-w-72 items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1 text-sm whitespace-nowrap text-foreground/85 transition-colors hover:bg-background/70 hover:text-foreground"
          >
            <SquareDashedMousePointer className="size-3 shrink-0 text-primary/60 transition-colors group-hover:text-primary/80" />
            <span className="truncate">{triggerLabel}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onClear() }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClear() }
              }}
              className="ml-0.5 cursor-pointer text-muted-foreground/70 hover:text-foreground"
            >
              <X className="size-3" />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="w-80 max-w-[calc(100vw-2rem)] p-3"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
            <SquareDashedMousePointer className="size-3 text-primary/60" />
            <span>{t('chat.browser.annotationCount', { count: annotations.length })}</span>
          </div>
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {annotations.map((a) => {
              const label = labelOf(a, t('chat.browser.annotateElement'), t('chat.browser.annotateRegion'))
              return (
                <div key={a.id} className="group/anno relative rounded-md bg-muted p-2 pr-7">
                  {a.screenshot ? (
                    <img
                      src={`data:image/png;base64,${a.screenshot}`}
                      alt={label}
                      className="mb-1.5 max-h-40 w-full rounded border border-border object-contain"
                    />
                  ) : null}
                  {a.comment.trim() ? (
                    <p className="text-xs leading-relaxed text-foreground/90">{a.comment.trim()}</p>
                  ) : null}
                  <p className="mt-0.5 flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground">
                    {a.kind === 'element'
                      ? <MousePointerClick className="size-3 shrink-0" />
                      : <SquareDashedMousePointer className="size-3 shrink-0" />}
                    <span className="truncate">{label}</span>
                  </p>
                  {a.styleChanges.length > 0 && (
                    <div className="mt-1 flex flex-col gap-0.5">
                      {a.styleChanges.map((c, i) => (
                        <div key={i} className="flex items-center gap-1 font-mono text-[10px] leading-tight">
                          <Paintbrush className="size-2.5 shrink-0 text-primary/70" />
                          <span className="shrink-0 text-foreground/60">{c.property}</span>
                          <span className="truncate text-muted-foreground/60 line-through decoration-muted-foreground/40">{c.previousValue || '—'}</span>
                          <span className="shrink-0 text-muted-foreground/50">→</span>
                          <span className="truncate text-primary/80">{c.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemove(a.id)}
                    className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover/anno:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
