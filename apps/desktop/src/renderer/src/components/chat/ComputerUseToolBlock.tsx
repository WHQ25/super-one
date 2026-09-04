import { useMemo } from 'react'
import {
  ComputerUseToolBlockPresenter,
  type ComputerUseToolBlockPresenterProps,
} from '@superone/chat-view/presenters/ComputerUseToolBlock'
import { useAppIcon } from '@/hooks/use-app-icon'
import { getStallColor, type StallLevel } from '@/lib/stall-utils'
import { ActionRecordingView, parseActionRecording } from './ActionRecordingView'
import {
  computerTargetBundleId,
  parseComputerResult,
} from './computer-tool-display'
import { ComputerResultView } from './computer-result-view'
import { ToolScreenshotView } from './ToolScreenshotView'

interface ComputerUseToolBlockProps extends Omit<
  ComputerUseToolBlockPresenterProps,
  | 'elapsedClassName'
  | 'identityIcon'
  | 'renderScreenshot'
  | 'renderResult'
  | 'recording'
> {
  stallLevel: StallLevel
}

/** Desktop host adapter for app identity, media loading, and rich result sections. */
export function ComputerUseToolBlock({
  op,
  params,
  result,
  isError,
  stallLevel,
  ...props
}: ComputerUseToolBlockProps) {
  const info = useMemo(
    () => parseComputerResult(op, result, !!isError, params),
    [op, result, isError, params],
  )
  const bundleId = useMemo(
    () => computerTargetBundleId(op, params, info),
    [op, params, info],
  )
  const appIcon = useAppIcon(bundleId)
  const recording = useMemo(() => parseActionRecording(result), [result])

  return (
    <ComputerUseToolBlockPresenter
      {...props}
      op={op}
      params={params}
      result={result}
      isError={isError}
      elapsedClassName={getStallColor(stallLevel)}
      identityIcon={appIcon ? (
        <img
          src={appIcon}
          alt=""
          draggable={false}
          className="size-3.5 shrink-0 rounded-[22%] object-contain"
        />
      ) : undefined}
      renderScreenshot={(path, label, unavailableLabel) => (
        <ToolScreenshotView path={path} label={label} unavailableLabel={unavailableLabel} />
      )}
      renderResult={(text) => <ComputerResultView text={text} />}
      recording={recording ? <ActionRecordingView recording={recording} /> : undefined}
    />
  )
}
