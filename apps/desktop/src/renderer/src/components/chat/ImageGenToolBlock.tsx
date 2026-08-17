import { useTranslation } from 'react-i18next'
import { ToolIcon } from './ToolIcon'
import { ExpandableToolRow, toolOutcomeLabel, withStreamingEllipsis } from './tool-row'
import { isMediaToolErrorResult, mediaToolErrorMessage } from './media-generation'
import { MediaImageRefThumb, MediaParamRow } from './media-tool-params'

export interface ImageGenToolBlockProps {
  params: Record<string, unknown>
  result?: string | null
  isStreaming?: boolean
  isError?: boolean
  isDenied?: boolean
  allowExpand?: boolean
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function referenceImagePaths(params: Record<string, unknown>): string[] {
  return Array.isArray(params.reference_image_paths)
    ? params.reference_image_paths.filter((path): path is string => typeof path === 'string' && path.length > 0)
    : []
}

export function ImageGenToolBlock({
  params,
  result,
  isStreaming = false,
  isError,
  isDenied,
  allowExpand = true,
}: ImageGenToolBlockProps) {
  const { t } = useTranslation()
  const prompt = String(params.prompt ?? '').replace(/\s+/g, ' ').trim()
  const failed = !isDenied && isMediaToolErrorResult(result, isError)
  const error = mediaToolErrorMessage(result)
  const label = toolOutcomeLabel({
    streaming: isStreaming,
    interrupted: !!isDenied || failed,
    streamingLabel: t('chat.toolBlock.generatingImage'),
    actionLabel: t('chat.toolBlock.generateImage'),
    doneLabel: t('chat.toolBlock.generatedImage'),
  })

  return (
    <ExpandableToolRow
      icon={<ToolIcon icon="image" className="size-3 shrink-0 text-muted-foreground" />}
      label={withStreamingEllipsis(label, isStreaming)}
      summary={prompt || undefined}
      streaming={isStreaming}
      tone={isDenied ? 'denied' : failed ? 'error' : 'default'}
      expandable={allowExpand && !isStreaming && (failed || !!isDenied)}
    >
      <ImageGenExpandBody params={params} error={error} />
    </ExpandableToolRow>
  )
}

function ImageGenExpandBody({
  params,
  error,
}: {
  params: Record<string, unknown>
  error: string
}) {
  const { t } = useTranslation()
  const prompt = typeof params.prompt === 'string' ? params.prompt : ''
  const provider = stringParam(params, 'provider')
  const model = stringParam(params, 'model')
  const aspectRatio = stringParam(params, 'aspect_ratio')
  const size = stringParam(params, 'size')
  const refs = referenceImagePaths(params)
  const fields = 'chat.toolBlock.image.fields'

  return (
    <div className="space-y-2">
      {error ? (
        <div className="whitespace-pre-wrap break-words text-warning/90">{error}</div>
      ) : null}
      {refs.length > 0 ? (
        <div className="space-y-2">
          <span className="text-xs font-medium text-foreground">{t(`${fields}.referenceImages`)}</span>
          <div className="flex flex-wrap gap-2">
            {refs.map((path, index) => (
              <MediaImageRefThumb
                key={path}
                path={path}
                label={t(`${fields}.reference`, { index: index + 1 })}
              />
            ))}
          </div>
        </div>
      ) : null}
      {prompt ? <MediaParamRow label={t(`${fields}.prompt`)} value={prompt} /> : null}
      <div className="grid grid-cols-1 gap-x-3 gap-y-1 @md:grid-cols-2">
        {provider ? <MediaParamRow label={t(`${fields}.provider`)} value={provider} /> : null}
        {model ? <MediaParamRow label={t(`${fields}.model`)} value={model} /> : null}
        {aspectRatio ? <MediaParamRow label={t(`${fields}.aspectRatio`)} value={aspectRatio} /> : null}
        {size ? <MediaParamRow label={t(`${fields}.size`)} value={size} /> : null}
      </div>
    </div>
  )
}
