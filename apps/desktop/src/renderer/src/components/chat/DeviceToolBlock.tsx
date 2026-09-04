import { useMemo } from 'react'
import {
  DeviceToolBlockPresenter,
  type DeviceToolBlockPresenterProps,
} from '@superone/chat-view/presenters/DeviceToolBlock'
import { getStallColor, type StallLevel } from '@/lib/stall-utils'
import { ActionRecordingView, parseActionRecording } from './ActionRecordingView'
import { PrettyJSONCodeBlock } from './tool-result-views'
import { ToolScreenshotView } from './ToolScreenshotView'

interface DeviceToolBlockProps extends Omit<
  DeviceToolBlockPresenterProps,
  'elapsedClassName' | 'renderScreenshot' | 'renderJson' | 'recording'
> {
  stallLevel: StallLevel
}

/** Desktop host adapter for the shared Device presenter. */
export function DeviceToolBlock({ stallLevel, result, ...props }: DeviceToolBlockProps) {
  const recording = useMemo(() => parseActionRecording(result), [result])
  return (
    <DeviceToolBlockPresenter
      {...props}
      result={result}
      elapsedClassName={getStallColor(stallLevel)}
      renderScreenshot={(path, label, unavailableLabel) => (
        <ToolScreenshotView path={path} label={label} unavailableLabel={unavailableLabel} />
      )}
      renderJson={(text) => <PrettyJSONCodeBlock text={text} />}
      recording={recording ? <ActionRecordingView recording={recording} /> : undefined}
    />
  )
}
