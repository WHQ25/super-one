import { Loader2 } from 'lucide-react'
import { useResolvedMediaSrc } from '@/hooks/use-resolved-media-src'
import { MarkdownAudioPlayer, MarkdownVideoPlayer } from './markdown-media-player'

interface MarkdownRemoteMediaProps {
  kind: 'video' | 'audio'
  src: string | undefined
}

/** Async video/audio for remote-media:// refs from chat markdown. */
export function MarkdownRemoteMedia({ kind, src }: MarkdownRemoteMediaProps) {
  const { displaySrc, loading, failed } = useResolvedMediaSrc(src)

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Loading media…
      </span>
    )
  }
  if (failed || !displaySrc) {
    return <span className="text-xs text-muted-foreground">Media unavailable</span>
  }
  if (kind === 'video') return <MarkdownVideoPlayer src={displaySrc} />
  return <MarkdownAudioPlayer src={displaySrc} source={src} />
}
