import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { ToolIcon } from '../ToolIcon'
import { ToolErrorText } from '../tool-result-views'
import {
  ExpandableToolRow,
  toolOutcomeLabel,
  withStreamingEllipsis,
  type ToolRowTone,
} from '../tool-row'

export {
  ConfigApplyBlockPresenter as ConfigApplyBlock,
  type ConfigApplyBlockPresenterProps as ConfigApplyBlockProps,
} from '@superone/chat-view/presenters/ConfigApplyBlock'

function toolRowTone(isDenied?: boolean, isError?: boolean): ToolRowTone {
  if (isDenied) return 'denied'
  if (isError) return 'error'
  return 'default'
}

/** Desktop-only mini-app setup row; iframe mini-app surfaces remain deferred. */
export function SetupMiniAppDevBlock({ appName, isStreaming, params, result, isDenied, isError, allowExpand }: {
  appName: string
  isStreaming: boolean
  params: Record<string, unknown>
  result: Record<string, unknown> | null
  isDenied?: boolean
  isError?: boolean
  allowExpand: boolean
}) {
  const { t } = useTranslation()
  const errored = !!isError || (!!result && result.status === 'error')
  const tone = toolRowTone(isDenied, errored)
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
      tone={tone}
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
