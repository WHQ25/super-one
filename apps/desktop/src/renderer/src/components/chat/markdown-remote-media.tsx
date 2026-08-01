import type { CSSProperties } from 'react'
import { Loader2 } from 'lucide-react'
import { useResolvedMediaSrc } from '@/hooks/use-resolved-media-src'

interface MarkdownRemoteMediaProps {
  kind: 'video' | 'audio'
  src: string | undefined
  style?: CSSProperties
}

/** Async video/audio for remote-media:// refs from chat markdown. */
export function MarkdownRemoteMedia({ kind, src, style }: MarkdownRemoteMediaProps) {
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
  if (kind === 'video') {
    return <video src={displaySrc} controls preload="metadata" style={style} />
  }
  return <audio src={displaySrc} controls />
}
