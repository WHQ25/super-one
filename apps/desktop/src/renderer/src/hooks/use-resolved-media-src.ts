import { useEffect, useState } from 'react'
import { isRemoteMediaUrl, resolveDisplayMediaSrc } from '@/lib/remote-media-url'
import { toMediaUrl } from '@/lib/path-utils'

function localFileToMediaUrl(src: string | undefined): string | undefined {
  if (!src) return src
  if (src.startsWith('local-file:///')) {
    try {
      const filePath = decodeURIComponent(new URL(src).pathname)
      return toMediaUrl(filePath)
    } catch {
      return src
    }
  }
  return src
}

/**
 * Resolve markdown media src for display.
 * - local-file → media-server / local-file URL (sync)
 * - remote-media → async readProjectFile → data URI
 * - http/data → passthrough
 */
export function useResolvedMediaSrc(src: string | undefined): {
  displaySrc: string | undefined
  loading: boolean
  failed: boolean
} {
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
  if (isRemote) return { displaySrc: remoteSrc, loading, failed }
  return { displaySrc: localFileToMediaUrl(src) ?? src, loading: false, failed: false }
}
