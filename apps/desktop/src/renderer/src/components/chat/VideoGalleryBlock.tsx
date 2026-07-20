import { AlertCircle, Loader2, Video as VideoIcon } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import type { VideoGenerationItem } from '@superone/shared/agent-types'
import { toMediaUrl } from '@/lib/path-utils'

const TILE = 'h-40 flex-none overflow-hidden rounded-md border border-border'

/**
 * Videos stream from the local media server rather than being inlined as a data URI: a clip runs to
 * tens of megabytes, and the server speaks HTTP Range so seeking works without loading it all.
 */
function VideoThumb({ item }: { item: VideoGenerationItem }) {
  if (item.status === 'failed') {
    return (
      <div className={cn(TILE, 'flex w-40 items-center justify-center border-destructive/30 bg-destructive/5 text-destructive')}>
        <AlertCircle className="size-4" />
      </div>
    )
  }

  if (!item.savedPath) {
    return (
      <div className={cn(TILE, 'flex w-64 items-center justify-center gap-2 bg-muted/30 text-xs text-muted-foreground')}>
        <Loader2 className="size-3.5 animate-spin" />
        <span>Rendering…</span>
      </div>
    )
  }

  return (
    <video
      src={toMediaUrl(item.savedPath)}
      controls
      preload="metadata"
      aria-label={item.prompt ?? 'Generated video'}
      className={cn(TILE, 'bg-black')}
    />
  )
}

export function VideoGalleryBlock({ items }: { items: VideoGenerationItem[] }) {
  const generating = items.some((it) => it.status === 'in_progress')
  const done = items.filter((it) => it.savedPath).length

  return (
    <div className="my-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <VideoIcon className="size-3.5 shrink-0" />
        <span>
          {generating
            ? 'Generating video… this usually takes a few minutes'
            : `${done} video${done === 1 ? '' : 's'} generated`}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => (
          <VideoThumb key={it.id} item={it} />
        ))}
      </div>
    </div>
  )
}
