import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Video as VideoIcon, TriangleAlert, Loader2, Image, FileVideo, FileAudio, AlertCircle } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { useActiveSession } from '@/stores/chat'
import { FileChip } from './ToolBlock'
import { useImageDataUri } from './image-shared'

interface VideoGenToolBlockProps {
  params: Record<string, unknown>
  result?: string
  isStreaming: boolean
}

function parseResult(resultText: string | undefined): Record<string, unknown> | null {
  if (!resultText) return null
  try {
    const parsed = JSON.parse(resultText)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-all font-medium text-foreground">{value}</span>
    </div>
  )
}

function BooleanParamRow({ label, value, onLabel, offLabel }: { label: string; value: boolean | undefined; onLabel: string; offLabel: string }) {
  if (value === undefined) return null
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-all font-medium text-foreground">{value ? onLabel : offLabel}</span>
    </div>
  )
}

function ImageRefThumb({ path, label }: { path: string; label: string }) {
  const { dataUri, loadError } = useImageDataUri(path, false)

  return (
    <div className="flex w-16 flex-none flex-col gap-1">
      <div className="h-16 w-16 overflow-hidden rounded-md border border-border bg-muted/30">
        {loadError ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <AlertCircle className="size-3" />
          </div>
        ) : dataUri ? (
          <img src={dataUri} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Image className="size-4" />
          </div>
        )}
      </div>
      <span className="truncate text-center text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function FileRefChip({ path, label, icon: Icon }: { path: string; label: string; icon: typeof FileVideo }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{label}</span>
      <FileChip name={path.split('/').pop() || path} title={path} filePath={path} />
    </div>
  )
}

export function VideoGenToolBlock({ params, result, isStreaming }: VideoGenToolBlockProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const resultParsed = parseResult(result)
  const generationId = typeof resultParsed?.generationId === 'string' ? resultParsed.generationId : undefined
  const genStatus = useActiveSession((s) => (generationId ? s.videoGenStatuses[generationId] : undefined))

  const prompt = String(params.prompt ?? '')
  const title = prompt.length > 60 ? prompt.slice(0, 60) + '…' : prompt
  const provider = typeof params.provider === 'string' ? params.provider : undefined
  const model = typeof params.model === 'string' ? params.model : undefined
  const firstFramePath = typeof params.first_frame_path === 'string' ? params.first_frame_path : undefined
  const lastFramePath = typeof params.last_frame_path === 'string' ? params.last_frame_path : undefined
  const referenceImagePaths = Array.isArray(params.reference_image_paths) ? params.reference_image_paths.filter((p): p is string => typeof p === 'string') : undefined
  const referenceVideoPaths = Array.isArray(params.reference_video_paths) ? params.reference_video_paths.filter((p): p is string => typeof p === 'string') : undefined
  const referenceAudioPaths = Array.isArray(params.reference_audio_paths) ? params.reference_audio_paths.filter((p): p is string => typeof p === 'string') : undefined
  const aspectRatio = typeof params.aspect_ratio === 'string' ? params.aspect_ratio : undefined
  const resolution = typeof params.resolution === 'string' ? params.resolution : undefined
  const duration = typeof params.duration === 'number' ? params.duration : undefined
  const fps = typeof params.fps === 'number' ? params.fps : undefined
  const seed = typeof params.seed === 'number' ? params.seed : undefined
  const generateAudio = typeof params.generate_audio === 'boolean' ? params.generate_audio : undefined
  const watermark = typeof params.watermark === 'boolean' ? params.watermark : undefined
  const cameraFixed = typeof params.camera_fixed === 'boolean' ? params.camera_fixed : undefined

  const hasRefs = firstFramePath || lastFramePath || (referenceImagePaths && referenceImagePaths.length > 0) || (referenceVideoPaths && referenceVideoPaths.length > 0) || (referenceAudioPaths && referenceAudioPaths.length > 0)
  const hasAdvanced = fps !== undefined || seed !== undefined || generateAudio !== undefined || watermark !== undefined || cameraFixed !== undefined

  const currentStatus = genStatus?.status ?? (resultParsed?.status === 'error' ? 'error' : (result ? 'submitted' : undefined))
  const isFailed = currentStatus === 'error'
  const statusError = genStatus?.error ?? (resultParsed?.status === 'error' ? String(resultParsed.message ?? '') : undefined)

  const badgeLabel = useMemo(() => {
    switch (currentStatus) {
      case 'submitted':
      case 'running': return t('chat.videoGenToolBlock.submitted', 'Submitted')
      case 'generated': return t('chat.videoGenToolBlock.completed', 'Completed')
      case 'error': return t('chat.videoGenToolBlock.failed', 'Failed')
      default: return ''
    }
  }, [currentStatus, t])

  const onLabel = t('chat.videoGenToolBlock.on', 'on')
  const offLabel = t('chat.videoGenToolBlock.off', 'off')

  const hasResult = !!result && !isStreaming

  return (
    <div className={cn(
      'tool-node my-0.5 rounded transition-colors',
      isFailed ? 'errored bg-warning/10' : 'bg-muted/20',
      hasResult && 'cursor-pointer',
      hasResult && (isFailed ? 'hover:bg-warning/20' : 'hover:bg-muted/40'),
    )}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={hasResult ? () => setExpanded((e) => !e) : undefined}
      >
        {isFailed ? (
          <TriangleAlert className="size-3 shrink-0 text-warning" />
        ) : (
          <VideoIcon className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className={cn('shrink-0 font-medium', isFailed ? 'text-warning' : 'text-foreground')}>
          {isStreaming ? <>{t('chat.videoGenToolBlock.generating')}…</> : t('chat.videoGenToolBlock.label')}
        </span>
        {title && <span className="min-w-0 truncate text-muted-foreground">{title}</span>}
        {badgeLabel && (
          <span className={cn(
            'shrink-0 rounded px-1 py-px text-xs',
            isFailed ? 'bg-warning/20 text-warning' : 'bg-muted text-muted-foreground',
          )}>
            {badgeLabel}
          </span>
        )}
        {hasResult && (
          <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
        )}
      </div>

      {hasResult && (
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <div className="space-y-2 border-t border-border/40 px-2 py-2 text-xs">
              {expanded && (
                <>
                  {hasRefs && (
                    <div className="space-y-2">
                      <span className="text-xs font-medium text-foreground">{t('chat.videoGenToolBlock.referenceMaterials')}</span>
                      {(firstFramePath || lastFramePath) && (
                        <div className="flex flex-wrap gap-2">
                          {firstFramePath && <ImageRefThumb path={firstFramePath} label={t('chat.videoGenToolBlock.firstFrame')} />}
                          {lastFramePath && <ImageRefThumb path={lastFramePath} label={t('chat.videoGenToolBlock.lastFrame')} />}
                        </div>
                      )}
                      {referenceImagePaths && referenceImagePaths.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {referenceImagePaths.map((p, i) => (
                            <ImageRefThumb key={p} path={p} label={t('chat.videoGenToolBlock.reference', { index: i + 1 })} />
                          ))}
                        </div>
                      )}
                      {referenceVideoPaths && referenceVideoPaths.length > 0 && (
                        <div className="space-y-1">
                          {referenceVideoPaths.map((p) => (
                            <FileRefChip key={p} path={p} label={t('chat.videoGenToolBlock.referenceVideos')} icon={FileVideo} />
                          ))}
                        </div>
                      )}
                      {referenceAudioPaths && referenceAudioPaths.length > 0 && (
                        <div className="space-y-1">
                          {referenceAudioPaths.map((p) => (
                            <FileRefChip key={p} path={p} label={t('chat.videoGenToolBlock.referenceAudio')} icon={FileAudio} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-1">
                    <ParamRow label={t('chat.videoGenToolBlock.prompt')} value={prompt} />
                  </div>

                  <div className="grid grid-cols-1 @md:grid-cols-2 gap-x-3 gap-y-1">
                    {provider && <ParamRow label={t('chat.videoGenToolBlock.provider')} value={provider} />}
                    {model && <ParamRow label={t('chat.videoGenToolBlock.model')} value={model} />}
                    {aspectRatio && <ParamRow label={t('chat.videoGenToolBlock.aspectRatio')} value={aspectRatio} />}
                    {resolution && <ParamRow label={t('chat.videoGenToolBlock.resolution')} value={resolution} />}
                    {duration !== undefined && <ParamRow label={t('chat.videoGenToolBlock.duration')} value={`${duration}s`} />}
                    {hasAdvanced && (
                      <>
                        {fps !== undefined && <ParamRow label={t('chat.videoGenToolBlock.fps')} value={String(fps)} />}
                        {seed !== undefined && <ParamRow label={t('chat.videoGenToolBlock.seed')} value={String(seed)} />}
                        <BooleanParamRow label={t('chat.videoGenToolBlock.generateAudio')} value={generateAudio} onLabel={onLabel} offLabel={offLabel} />
                        <BooleanParamRow label={t('chat.videoGenToolBlock.watermark')} value={watermark} onLabel={onLabel} offLabel={offLabel} />
                        <BooleanParamRow label={t('chat.videoGenToolBlock.cameraFixed')} value={cameraFixed} onLabel={onLabel} offLabel={offLabel} />
                      </>
                    )}
                  </div>

                  {currentStatus && (
                    <div className={cn(
                      'flex items-center gap-1.5 rounded px-2 py-1',
                      currentStatus === 'running' ? 'bg-primary/10 text-primary' :
                      isFailed ? 'text-warning/90' :
                      'bg-muted/40 text-muted-foreground',
                    )}>
                      {currentStatus === 'running' && <Loader2 className="size-3 shrink-0 animate-spin" />}
                      <span className="font-medium">{badgeLabel}</span>
                      {statusError && <span>— {statusError}</span>}
                      {genStatus?.warnings && genStatus.warnings.length > 0 && (
                        <span className="text-warning/80">({genStatus.warnings.length} warning{genStatus.warnings.length !== 1 ? 's' : ''})</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
