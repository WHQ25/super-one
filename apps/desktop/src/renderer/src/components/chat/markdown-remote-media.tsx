import { Loader2 } from 'lucide-react'
import { useResolvedMediaSrc } from '@/hooks/use-resolved-media-src'
import { MarkdownAudioPlayer, MarkdownVideoPlayer, videoSelectionMarkdown } from './markdown-media-player'

interface MarkdownRemoteMediaProps {
  kind: 'video' | 'audio'
  src: string | undefined
  alt?: string
}

/** Async video/audio for remote-media:// refs from chat markdown. */
export function MarkdownRemoteMedia({ kind, src, alt }: MarkdownRemoteMediaProps) {
  const { displaySrc, filePath, loading, failed } = useResolvedMediaSrc(src)

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
  if (kind === 'video') {
    return (
      <MarkdownVideoPlayer
        src={displaySrc}
        filePath={filePath}
        copyText={filePath ? videoSelectionMarkdown(alt, filePath) : undefined}
      />
    )
  }
  return <MarkdownAudioPlayer src={displaySrc} source={src} />
}
