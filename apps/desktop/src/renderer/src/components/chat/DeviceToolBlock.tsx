import { useMemo } from 'react'
import {
  DeviceToolBlockPresenter,
  type DeviceToolBlockPresenterProps,
} from '@superone/chat-view/presenters/DeviceToolBlock'
import { getStallColor, type StallLevel } from '@/lib/stall-utils'
import { liveRunId, useJevRunActions } from '@/hooks/use-jev-run-actions'
import { parseDeviceResult } from './device-tool-display'
import { ActionRecordingView, parseActionRecording } from './ActionRecordingView'
import { PrettyJSONCodeBlock } from './tool-result-views'
import { ToolScreenshotView } from './ToolScreenshotView'

interface DeviceToolBlockProps extends Omit<
  DeviceToolBlockPresenterProps,
  'elapsedClassName' | 'renderScreenshot' | 'renderJson' | 'recording' | 'runActions'
> {
  stallLevel: StallLevel
}

/** Desktop host adapter for the shared Device presenter. */
export function DeviceToolBlock({ stallLevel, result, ...props }: DeviceToolBlockProps) {
  const recording = useMemo(() => parseActionRecording(result), [result])
  const info = useMemo(
    () => parseDeviceResult(props.op, result, !!props.isError),
    [props.op, result, props.isError],
  )
  const runActions = useJevRunActions(props.op === 'run', liveRunId(props.runContinuations) ?? info.runId)
  return (
    <DeviceToolBlockPresenter
      {...props}
      result={result}
      runActions={runActions}
      elapsedClassName={getStallColor(stallLevel)}
      renderScreenshot={(path, label, unavailableLabel) => (
        <ToolScreenshotView path={path} label={label} unavailableLabel={unavailableLabel} />
      )}
      renderJson={(text) => <PrettyJSONCodeBlock text={text} />}
      recording={recording ? <ActionRecordingView recording={recording} /> : undefined}
    />
  )
}
