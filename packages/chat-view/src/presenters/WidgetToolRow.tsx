import { useTranslation } from 'react-i18next'
import { CompactLabeledToolRow } from './ToolRow'
import { ToolIcon } from './ToolIcon'

/** The title of a `widget_show` call, read from its input; nothing for a partial or projected input. */
export function widgetTitleFromInput(input: string): string | undefined {
  try {
    const title = (JSON.parse(input) as { title?: unknown } | null)?.title
    return typeof title === 'string' ? title : undefined
  } catch {
    return undefined
  }
}

/**
 * A `widget_show` call drawn as a tool row instead of its widget: while it is being
 * generated, and inside a subagent's card, which stays a summary on desktop and phone.
 */
export function WidgetToolRow({ title, streaming = false }: { title?: string; streaming?: boolean }) {
  const { t } = useTranslation()
  return (
    <CompactLabeledToolRow
      icon={<ToolIcon icon="widget" className="size-3 shrink-0 text-muted-foreground" />}
      label={streaming ? t('chat.toolBlock.generatingWidget') : t('chat.toolBlock.generateWidget')}
      streaming={streaming}
      summary={title ? title.replace(/_/g, ' ') : undefined}
    />
  )
}
