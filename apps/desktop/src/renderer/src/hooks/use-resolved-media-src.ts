import { useEffect, useState } from 'react'
import { isRemoteMediaUrl, resolveDisplayMediaSrc } from '@/lib/remote-media-url'
import { localFileUrlToPath, mediaUrlFor } from '@/lib/path-utils'
import { useMediaServerPort } from './use-media-server-port'

function localFileToMediaUrl(src: string | undefined, port: number): string | undefined {
  if (!src) return src
  const filePath = localFileUrlToPath(src)
  return filePath ? mediaUrlFor(filePath, port) : src
}

/**
 * Resolve markdown media src for display.
 * - local-file → media-server / local-file URL (sync)
 * - remote-media → async readProjectFile → data URI, or a local-file URL for
 *   session-zone media, which then streams like a local file
 * - http/data → passthrough
 */
export function useResolvedMediaSrc(src: string | undefined): {
  displaySrc: string | undefined
  loading: boolean
  failed: boolean
} {
  const port = useMediaServerPort()
  const isRemote = isRemoteMediaUrl(src)
  const [remoteSrc, setRemoteSrc] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(isRemote)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!src || !isRemoteMediaUrl(src)) {
      setRemoteSrc(undefined)
      setLoading(false)
      setFailed(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setFailed(false)
    void resolveDisplayMediaSrc(src).then((resolved) => {
      if (cancelled) return
      if (!resolved) {
        setRemoteSrc(undefined)
        setFailed(true)
      } else {
        setRemoteSrc(resolved)
        setFailed(false)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [src])

  if (!src) return { displaySrc: undefined, loading: false, failed: false }
  if (isRemote) return { displaySrc: localFileToMediaUrl(remoteSrc, port), loading, failed }
  return { displaySrc: localFileToMediaUrl(src, port) ?? src, loading: false, failed: false }
}
