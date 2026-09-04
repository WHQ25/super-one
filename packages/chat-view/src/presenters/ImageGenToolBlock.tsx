import type { ReactNode } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ExpandableToolRow, toolOutcomeLabel, withStreamingEllipsis } from './ToolRow'

export interface ImageGenToolBlockPresenterProps {
  params: Record<string, unknown>
  result?: string | null
  isStreaming?: boolean
  isError?: boolean
  isDenied?: boolean
  allowExpand?: boolean
  renderReferenceImage?: (path: string, label: string) => ReactNode
}

function mediaError(result?: string | null): string {
  if (!result) return ''
  try {
    const parsed = JSON.parse(result) as { message?: unknown; error?: unknown }
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim()
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim()
  } catch { /* plain tool error */ }
  return result.replace(/^\[Error\]\s*/i, '').trim()
}

function failedMediaResult(result?: string | null, isError?: boolean): boolean {
  if (isError) return true
  if (!result) return false
  try { return (JSON.parse(result) as { status?: unknown })?.status === 'error' } catch {
    return /^\[Error\]/i.test(result)
  }
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-all font-medium text-foreground">{value}</span>
    </div>
  )
}

/** Shared summary-first image-generation tool row. */
export function ImageGenToolBlockPresenter({
  params,
  result,
  isStreaming = false,
  isError,
  isDenied,
  allowExpand = true,
  renderReferenceImage,
}: ImageGenToolBlockPresenterProps) {
  const { t } = useTranslation()
  const prompt = String(params.prompt ?? '').replace(/\s+/g, ' ').trim()
  const failed = !isDenied && failedMediaResult(result, isError)
  const error = mediaError(result)
  const refs = Array.isArray(params.reference_image_paths)
    ? params.reference_image_paths.filter((path): path is string => typeof path === 'string' && path.length > 0)
    : []
  const fields = 'chat.toolBlock.image.fields'
  const rows = [
    [t(`${fields}.prompt`), typeof params.prompt === 'string' ? params.prompt : ''],
    [t(`${fields}.provider`), stringParam(params, 'provider')],
    [t(`${fields}.model`), stringParam(params, 'model')],
    [t(`${fields}.aspectRatio`), stringParam(params, 'aspect_ratio')],
    [t(`${fields}.size`), stringParam(params, 'size')],
  ].filter((row): row is [string, string] => Boolean(row[1]))
  const label = toolOutcomeLabel({
    streaming: isStreaming,
    interrupted: Boolean(isDenied) || failed,
    streamingLabel: t('chat.toolBlock.generatingImage'),
    actionLabel: t('chat.toolBlock.generateImage'),
    doneLabel: t('chat.toolBlock.generatedImage'),
  })

  return (
    <ExpandableToolRow
      icon={<ImageIcon className="size-3 shrink-0 text-muted-foreground" />}
      label={withStreamingEllipsis(label, isStreaming)}
      summary={prompt || undefined}
      streaming={isStreaming}
      tone={isDenied ? 'denied' : failed ? 'error' : 'default'}
      expandable={allowExpand && !isStreaming && (failed || Boolean(isDenied))}
    >
      <div className="space-y-2">
        {error ? <div className="whitespace-pre-wrap break-words text-warning/90">{error}</div> : null}
        {refs.length > 0 && renderReferenceImage ? (
          <div className="space-y-2">
            <span className="text-xs font-medium text-foreground">{t(`${fields}.referenceImages`)}</span>
            <div className="flex flex-wrap gap-2">
              {refs.map((path, index) => renderReferenceImage(
                path,
                t(`${fields}.reference`, { index: index + 1 }),
              ))}
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-x-3 gap-y-1 @md:grid-cols-2">
          {rows.map(([rowLabel, value]) => <ParamRow key={rowLabel} label={rowLabel} value={value} />)}
        </div>
      </div>
    </ExpandableToolRow>
  )
}
