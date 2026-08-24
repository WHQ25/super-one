import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { useMediaUrl } from '@/hooks/use-media-server-port'

export interface ActionRecordingInfo {
  savedPath: string
  mimeType?: string
  durationMs?: number
}

export function parseActionRecording(
  result: string | undefined,
): ActionRecordingInfo | null {
  if (!result) return null
  try {
    const value = JSON.parse(result) as { recording?: Record<string, unknown> }
    const recording = value?.recording
    const savedPath =
      typeof recording?.savedPath === 'string'
        ? recording.savedPath
        : typeof recording?.path === 'string'
          ? recording.path
          : null
    if (!recording || !savedPath) return null
    return {
      savedPath,
      ...(typeof recording.mimeType === 'string'
        ? { mimeType: recording.mimeType }
        : {}),
      ...(typeof recording.durationMs === 'number'
        ? { durationMs: recording.durationMs }
        : {}),
    }
  } catch {
    return null
  }
}

export function ActionRecordingView({
  recording,
}: {
  recording: ActionRecordingInfo
}) {
  const src = useMediaUrl(recording.savedPath)
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [src])

  if (!src || failed) {
    return (
      <div className="flex h-28 items-center justify-center rounded border border-warning/30 bg-warning/5 text-warning">
        <AlertCircle className="size-4" />
      </div>
    )
  }

  return (
    <video
      src={src}
      controls
      preload="metadata"
      aria-label="Action recording"
      onError={() => setFailed(true)}
      className="max-h-80 w-full rounded border border-border bg-black"
    />
  )
}
