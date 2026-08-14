import { useEffect, useState } from 'react'
import { getMediaServerPortSync, mediaUrlFor, subscribeMediaServerPort } from '@/lib/path-utils'

/** Re-renders when the local media server port becomes available. */
export function useMediaServerPort(): number {
  const [port, setPort] = useState(getMediaServerPortSync)
  useEffect(() => subscribeMediaServerPort(setPort), [])
  return port
}

export function useMediaUrl(filePath: string | undefined): string | undefined {
  const port = useMediaServerPort()
  if (!filePath) return undefined
  return mediaUrlFor(filePath, port)
}
