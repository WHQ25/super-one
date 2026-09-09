import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { ToolIcon } from './ToolIcon'
import {
  ExpandableToolRow,
  ToolErrorText,
  toolOutcomeLabel,
  toolRowTone,
  withStreamingEllipsis,
} from './ToolRow'

/**
 * `miniapp_dev_setup` — the one SuperOne row that carries more than a subject line,
 * because a scaffolded app has an id, a directory, and a description worth reading
 * back. Running the setup is desktop-only (it needs the mini-app host process), but
 * *reading* what a session did is not, which is why the presenter is shared: the
 * phone renders exactly the same card for a call the desktop already made.
 */
export interface SetupMiniAppDevBlockPresenterProps {
  appName: string
  isStreaming: boolean
  params: Record<string, unknown>
  /** Parsed tool result, or null when it is absent, truncated, or not JSON. */
  result: Record<string, unknown> | null
  isDenied?: boolean
  isError?: boolean
  allowExpand: boolean
}

export function SetupMiniAppDevBlockPresenter({
  appName,
  isStreaming,
  params,
  result,
  isDenied,
  isError,
  allowExpand,
}: SetupMiniAppDevBlockPresenterProps) {
  const { t } = useTranslation()
  const errored = !!isError || (!!result && result.status === 'error')
  const headerLabel = toolOutcomeLabel({
    streaming: isStreaming,
    interrupted: !!isDenied || errored,
    streamingLabel: t('chat.toolBlock.settingUpMiniApp'),
    actionLabel: t('chat.toolBlock.setupMiniApp'),
    doneLabel: t('chat.toolBlock.setUpMiniApp'),
  })
  const appId = result?.appId ? String(result.appId) : ''
  const directory = params.directory ? String(params.directory) : ''
  const description = params.description ? String(params.description) : ''
  const errorMessage = errored ? String((result?.message as string | undefined) ?? '') : ''
  const rows: Array<{ key: string; label: string; value: string; mono?: boolean }> = []
  if (appId) rows.push({ key: 'appId', label: t('chat.toolBlock.setupFields.appId'), value: appId, mono: true })
  if (directory) rows.push({ key: 'directory', label: t('chat.toolBlock.setupFields.directory'), value: directory, mono: true })
  if (description) rows.push({ key: 'description', label: t('chat.toolBlock.setupFields.description'), value: description })

  return (
    <ExpandableToolRow
      icon={<ToolIcon icon="file-plus" className="size-3 shrink-0 text-muted-foreground" />}
      label={withStreamingEllipsis(headerLabel, isStreaming)}
      summary={appName || undefined}
      streaming={isStreaming}
      tone={toolRowTone(isDenied, errored)}
      expandable={allowExpand && (rows.length > 0 || !!errorMessage)}
    >
      <div className="space-y-1">
        {errorMessage ? <ToolErrorText className="mb-2">{errorMessage}</ToolErrorText> : null}
        {rows.map(({ key, label, value, mono }) => (
          <div key={key} className="flex items-baseline gap-2">
            <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
            <span className={cn('min-w-0 flex-1 break-all text-foreground', mono && 'font-mono')}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </ExpandableToolRow>
  )
}
