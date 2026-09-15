import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { isReadBrowserOp } from './presenters/browser-tool-display'
import type { ClaudeToolPresenterProps } from './presenters/ClaudeTurnBody'
import {
  PortableBrowserTool,
  PortableComputerTool,
  PortableDeviceTool,
  PortableTerminalTool,
  portableBrowserOp,
  portableComputerOp,
  portableDeviceOp,
  portableTerminalOp,
} from './PortableInteractiveTools'
import { useDeferredText } from './use-deferred-text'

function parseDetail(text: string): Partial<ClaudeToolPresenterProps> {
  try { return JSON.parse(text) as Partial<ClaudeToolPresenterProps> } catch { return {} }
}

export function isPortableInteractiveTool(toolName: string, input: unknown): boolean {
  return Boolean(portableBrowserOp(toolName, input) || portableComputerOp(toolName) || portableDeviceOp(toolName) || portableTerminalOp(toolName))
}

/**
 * Browser / computer / device rows on the phone. The collapsed chrome is the
 * same presenter the desktop uses; GenericToolRow would print `superone ·
 * browser snapshot` instead. Expansion fetches the deferred result so a
 * screenshot can load its image.
 */
export function DeferredInteractiveTool(props: ClaudeToolPresenterProps): ReactNode {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const { text, error, loading, retry } = useDeferredText(
    props.remoteDetail ? [props.remoteDetail] : undefined,
    expanded,
    props.status !== 'streaming',
  )
  const detail = useMemo(() => parseDetail(text), [text])
  const input = detail.input || props.input
  const result = detail.result || props.result
  const browserOp = portableBrowserOp(props.toolName, input)
  const computerOp = portableComputerOp(props.toolName)
  const deviceOp = portableDeviceOp(props.toolName)
  const terminalOp = portableTerminalOp(props.toolName)
  const waitsForResult = browserOp === 'screenshot'
    || (browserOp != null && isReadBrowserOp(browserOp))
    || computerOp != null
    || deviceOp != null
    || terminalOp != null
  const pendingDetails = props.remoteDetail && !result && props.status !== 'streaming' && waitsForResult
    ? (
      error
        ? (
          <div role="status">
            {error}
            <button type="button" className="ml-2 underline" onClick={retry}>{t('common.retry')}</button>
          </div>
        )
        : expanded && loading
          ? <div role="status">{t('common.loading')}</div>
          : <></>
    )
    : undefined
  const shared = {
    input,
    result,
    toolSummary: props.toolSummary,
    isStreaming: props.status === 'streaming',
    isError: props.isError,
    onExpandedChange: props.remoteDetail && waitsForResult ? setExpanded : undefined,
    pendingDetails,
  }
  if (browserOp) return <PortableBrowserTool op={browserOp} {...shared} />
  if (computerOp) return <PortableComputerTool op={computerOp} {...shared} />
  if (deviceOp) return <PortableDeviceTool op={deviceOp} {...shared} />
  if (terminalOp) return <PortableTerminalTool op={terminalOp} {...shared} />
  return null
}
