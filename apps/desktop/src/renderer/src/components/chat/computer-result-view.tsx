import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { PrettyJSONCodeBlock, TruncatedCodeBlock } from './tool-result-views'
import {
  splitComputerResult,
  type ComputerResultField,
  type ComputerResultTable,
} from './computer-result-sections'

/**
 * Render a computer_* result for a human, in the order a person reads it:
 * what happened, then the picture, then the tree, then the raw payload.
 *
 * Only the first two are worth showing unprompted. The tree is hundreds of rows
 * and the envelope is machine bookkeeping, so both stay folded until asked for.
 */

function Section({
  label,
  badge,
  children,
}: {
  label: string
  badge?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded bg-muted/30">
      <button
        type="button"
        onClick={(event: MouseEvent) => {
          event.stopPropagation()
          setOpen((value) => !value)
        }}
        className="flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        {badge && <span className="shrink-0 text-muted-foreground/70">{badge}</span>}
        <ChevronRight
          className={cn(
            'size-3 shrink-0 transition-transform duration-200',
            open && 'rotate-90',
          )}
        />
      </button>
      {open && <div className="px-1 pb-1">{children}</div>}
    </div>
  )
}

function FieldList({ fields }: { fields: ComputerResultField[] }) {
  const { t } = useTranslation()
  if (fields.length === 0) return null
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs">
      {fields.map(({ labelKey, value }) => {
        // Enum-valued fields already have translations; the rest are literals.
        const shown =
          labelKey === 'outcome' || labelKey === 'waitStatus'
            ? t(`chat.toolBlock.computer.${labelKey === 'outcome' ? 'outcome' : 'waitStatus'}.${value}`)
            : value
        return (
          <span key={labelKey} className="inline-flex min-w-0 items-baseline gap-1">
            <span className="shrink-0 text-muted-foreground/70">
              {t(`chat.toolBlock.computer.field.${labelKey}`)}
            </span>
            <span className="min-w-0 truncate text-foreground">{shown}</span>
          </span>
        )
      })}
    </div>
  )
}

function TreeSection({ tables }: { tables: ComputerResultTable[] }) {
  const { t } = useTranslation()
  const rows = tables.reduce((sum, table) => sum + (table.rows ?? 0), 0)
  return (
    <Section
      label={t('chat.toolBlock.computer.section.tree')}
      badge={rows > 0 ? t('chat.toolBlock.computer.nodesCount', { count: rows }) : undefined}
    >
      <div className="flex flex-col gap-1.5">
        {tables.map(({ key, toon }) => (
          <div key={key} className="flex flex-col gap-0.5">
            {tables.length > 1 && (
              <div className="px-2 font-mono text-xs text-muted-foreground/70">{key}</div>
            )}
            <TruncatedCodeBlock code={toon} language="text" />
          </div>
        ))}
      </div>
    </Section>
  )
}

export function ComputerResultView({ text }: { text: string }) {
  const { t } = useTranslation()
  const sections = useMemo(() => splitComputerResult(text), [text])
  // Errors and computer_apps' bare TOON never parse as an envelope.
  if (!sections) return <PrettyJSONCodeBlock text={text} />

  return (
    <div className="flex flex-col gap-1.5">
      <FieldList fields={sections.fields} />
      {sections.tables.length > 0 && <TreeSection tables={sections.tables} />}
      <Section label={t('chat.toolBlock.computer.section.raw')}>
        <PrettyJSONCodeBlock text={sections.envelope} />
      </Section>
    </div>
  )
}
