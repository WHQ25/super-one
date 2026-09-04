import { useMemo, type ReactNode } from 'react'
import { Loader2, Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { ToolName, ToolRow, ToolSummary, toolOutcomeLabel, withStreamingEllipsis } from './ToolRow'

export interface VideoGenerationLiveStatus {
  status?: string
  error?: string
  warnings?: string[]
}

export interface VideoGenToolBlockPresenterProps {
  params: Record<string, unknown>
  result?: string
  isStreaming: boolean
  isError?: boolean
  liveStatus?: VideoGenerationLiveStatus
  renderImageRef?: (path: string, label: string) => ReactNode
  renderFileRef?: (path: string, label: string, kind: 'video' | 'audio') => ReactNode
}

function parseResult(result?: string): Record<string, unknown> | null {
  if (!result) return null
  try {
    const parsed = JSON.parse(result)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch { return null }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function errorMessage(result?: string): string {
  if (!result) return ''
  const parsed = parseResult(result)
  if (typeof parsed?.message === 'string') return parsed.message
  if (typeof parsed?.error === 'string') return parsed.error
  return result.replace(/^\[Error\]\s*/i, '').trim()
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-all font-medium text-foreground">{value}</span>
    </div>
  )
}

/** Shared video-generation row; a host may enrich it with live polling state and file previews. */
export function VideoGenToolBlockPresenter({
  params,
  result,
  isStreaming,
  isError,
  liveStatus,
  renderImageRef,
  renderFileRef,
}: VideoGenToolBlockPresenterProps) {
  const { t } = useTranslation()
  const parsed = parseResult(result)
  const prompt = String(params.prompt ?? '')
  const title = prompt.length > 60 ? `${prompt.slice(0, 60)}…` : prompt
  const currentStatus = liveStatus?.status ?? (parsed?.status === 'error' ? 'error' : result ? 'submitted' : undefined)
  const failed = currentStatus === 'error' || Boolean(isError)
  const statusError = liveStatus?.error
    || (parsed?.status === 'error' ? String(parsed.message ?? '') : '')
    || (isError ? errorMessage(result) : '')
  const badge = useMemo(() => {
    if (currentStatus === 'submitted' || currentStatus === 'running') return t('chat.videoGenToolBlock.submitted', 'Submitted')
    if (currentStatus === 'generated') return t('chat.videoGenToolBlock.completed', 'Completed')
    return ''
  }, [currentStatus, t])
  const imageRefs = [
    [params.first_frame_path, t('chat.videoGenToolBlock.firstFrame')],
    [params.last_frame_path, t('chat.videoGenToolBlock.lastFrame')],
    ...strings(params.reference_image_paths).map((path, index) => [path, t('chat.videoGenToolBlock.reference', { index: index + 1 })]),
  ].filter((row): row is [string, string] => typeof row[0] === 'string')
  const videoRefs = strings(params.reference_video_paths)
  const audioRefs = strings(params.reference_audio_paths)
  const rows = [
    [t('chat.videoGenToolBlock.prompt'), prompt],
    [t('chat.videoGenToolBlock.provider'), params.provider],
    [t('chat.videoGenToolBlock.model'), params.model],
    [t('chat.videoGenToolBlock.aspectRatio'), params.aspect_ratio],
    [t('chat.videoGenToolBlock.resolution'), params.resolution],
    [t('chat.videoGenToolBlock.duration'), typeof params.duration === 'number' ? `${params.duration}s` : undefined],
    [t('chat.videoGenToolBlock.fps'), params.fps],
    [t('chat.videoGenToolBlock.seed'), params.seed],
  ].flatMap(([label, value]) => value === undefined || value === '' ? [] : [[String(label), String(value)] as const])
  const label = withStreamingEllipsis(toolOutcomeLabel({
    streaming: isStreaming,
    interrupted: failed,
    streamingLabel: t('chat.toolBlock.generatingVideo'),
    actionLabel: t('chat.toolBlock.generateVideo'),
    doneLabel: t('chat.toolBlock.generatedVideo'),
  }), isStreaming)

  return (
    <ToolRow
      icon={<Video className="size-3 shrink-0 text-muted-foreground" />}
      tone={failed ? 'error' : 'default'}
      expandable={Boolean(result) && !isStreaming}
      mountDetails="expanded"
      trailing={!failed && badge ? <span className="shrink-0 rounded bg-muted px-1 py-px text-xs text-muted-foreground">{badge}</span> : null}
      details={(
        <div className="space-y-2">
          {failed && statusError ? <div className="whitespace-pre-wrap text-warning/90">{statusError}</div> : null}
          {(imageRefs.length > 0 || videoRefs.length > 0 || audioRefs.length > 0) ? (
            <div className="space-y-2">
              <span className="text-xs font-medium text-foreground">{t('chat.videoGenToolBlock.referenceMaterials')}</span>
              <div className="flex flex-wrap gap-2">
                {renderImageRef ? imageRefs.map(([path, refLabel]) => renderImageRef(path, refLabel)) : null}
              </div>
              {renderFileRef ? videoRefs.map((path) => renderFileRef(path, t('chat.videoGenToolBlock.referenceVideos'), 'video')) : null}
              {renderFileRef ? audioRefs.map((path) => renderFileRef(path, t('chat.videoGenToolBlock.referenceAudio'), 'audio')) : null}
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-x-3 gap-y-1 @md:grid-cols-2">
            {rows.map(([rowLabel, value]) => <ParamRow key={rowLabel} label={rowLabel} value={value} />)}
          </div>
          {currentStatus ? (
            <div className={cn('flex items-center gap-1.5 rounded px-2 py-1', currentStatus === 'running' ? 'bg-primary/10 text-primary' : failed ? 'text-warning/90' : 'bg-muted/40 text-muted-foreground')}>
              {currentStatus === 'running' ? <Loader2 className="size-3 shrink-0 animate-spin" /> : null}
              <span className="font-medium">{badge}</span>
              {statusError ? <span>— {statusError}</span> : null}
            </div>
          ) : null}
        </div>
      )}
      detailsClassName="border-t border-border/40 px-2 py-2 text-xs"
    >
      <ToolName streaming={isStreaming} tone={failed ? 'error' : 'default'}>{label}</ToolName>
      {title ? <ToolSummary>{title}</ToolSummary> : null}
    </ToolRow>
  )
}
