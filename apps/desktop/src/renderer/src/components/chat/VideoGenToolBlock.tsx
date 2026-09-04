import { FileAudio, FileVideo } from 'lucide-react'
import { useActiveSession } from '@/stores/chat'
import { FileChip } from './ToolBlock'
import { MediaImageRefThumb } from './media-tool-params'
import {
  VideoGenToolBlockPresenter,
  type VideoGenToolBlockPresenterProps,
} from './presenters/VideoGenToolBlock'

function generationId(result?: string): string | undefined {
  if (!result) return undefined
  try {
    const parsed = JSON.parse(result) as { generationId?: unknown }
    return typeof parsed.generationId === 'string' ? parsed.generationId : undefined
  } catch { return undefined }
}

/** Desktop host adapter for live status and local-file affordances. */
export function VideoGenToolBlock(props: VideoGenToolBlockPresenterProps) {
  const id = generationId(props.result)
  const liveStatus = useActiveSession((state) => id ? state.videoGenStatuses[id] : undefined)
  return (
    <VideoGenToolBlockPresenter
      {...props}
      liveStatus={liveStatus}
      renderImageRef={(path, label) => <MediaImageRefThumb key={path} path={path} label={label} />}
      renderFileRef={(path, label, kind) => {
        const Icon = kind === 'video' ? FileVideo : FileAudio
        return (
          <div key={path} className="flex items-center gap-1.5">
            <Icon className="size-3 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{label}</span>
            <FileChip name={path.split('/').pop() || path} title={path} filePath={path} />
          </div>
        )
      }}
    />
  )
}
