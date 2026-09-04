import { FileText } from 'lucide-react'
import { requestNative } from './bridge'
import { BrowserToolBlockPresenter } from './presenters/BrowserToolBlock'
import { getBrowserOp, type BrowserOp } from './presenters/browser-tool-display'
import { ComputerUseToolBlockPresenter } from './presenters/ComputerUseToolBlock'
import { getComputerOp, type ComputerOp } from './presenters/computer-tool-display'
import { DeviceToolBlockPresenter } from './presenters/DeviceToolBlock'
import { getDeviceOp, type DeviceOp } from './presenters/device-tool-display'
import { ToolScreenshotViewPresenter } from './presenters/ToolScreenshotView'

function portableToolParams(input: unknown): Record<string, unknown> {
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  }
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

function portableSuperoneToolName(toolName: string): string | null {
  const prefix = 'mcp__superone__'
  return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : null
}

export function portableBrowserOp(toolName: string, input: unknown): BrowserOp | null {
  const bare = portableSuperoneToolName(toolName)
  return bare ? getBrowserOp(bare, portableToolParams(input)) : null
}

export function portableComputerOp(toolName: string): ComputerOp | null {
  const bare = portableSuperoneToolName(toolName)
  return bare ? getComputerOp(bare) : null
}

export function portableDeviceOp(toolName: string): DeviceOp | null {
  const bare = portableSuperoneToolName(toolName)
  return bare ? getDeviceOp(bare) : null
}

function PortableBrowserFile({ path, label }: { path: string; label: string }) {
  return (
    <button
      type="button"
      className="inline-flex min-w-0 max-w-56 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-foreground"
      onClick={() => requestNative('previewFile', { path })}
      aria-label={`Preview ${label}`}
      title={path}
    >
      <FileText className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </button>
  )
}

function PortableToolScreenshot({
  path,
  label,
  unavailableLabel,
}: {
  path: string
  label: string
  unavailableLabel: string
}) {
  return (
    <ToolScreenshotViewPresenter
      path={path}
      label={label}
      unavailableLabel={unavailableLabel}
      onPreview={(previewPath) => requestNative('previewFile', { path: previewPath })}
    />
  )
}

interface PortableInteractiveToolProps {
  input: unknown
  result?: string
  toolSummary?: string
  isStreaming: boolean
  isError?: boolean
}

function portableResult(result: string | undefined) {
  const isDenied = Boolean(result?.startsWith('[denied] '))
  return {
    isDenied,
    cleanResult: isDenied ? result?.slice('[denied] '.length) : result,
  }
}

export function PortableBrowserTool({
  op,
  input,
  result,
  toolSummary,
  isStreaming,
  isError,
}: PortableInteractiveToolProps & { op: BrowserOp }) {
  const outcome = portableResult(result)
  return (
    <BrowserToolBlockPresenter
      op={op}
      params={portableToolParams(input)}
      result={outcome.cleanResult}
      toolSummary={toolSummary}
      isStreaming={isStreaming}
      isError={isError}
      isDenied={outcome.isDenied}
      renderScreenshot={(path, label, unavailableLabel) => (
        <PortableToolScreenshot path={path} label={label} unavailableLabel={unavailableLabel} />
      )}
      renderFile={(path, filename) => <PortableBrowserFile path={path} label={filename} />}
    />
  )
}

export function PortableComputerTool({
  op,
  input,
  result,
  toolSummary,
  isStreaming,
  isError,
}: PortableInteractiveToolProps & { op: ComputerOp }) {
  const outcome = portableResult(result)
  return (
    <ComputerUseToolBlockPresenter
      op={op}
      params={portableToolParams(input)}
      result={outcome.cleanResult}
      toolSummary={toolSummary}
      isStreaming={isStreaming}
      isError={isError}
      isDenied={outcome.isDenied}
      renderScreenshot={(path, label, unavailableLabel) => (
        <PortableToolScreenshot path={path} label={label} unavailableLabel={unavailableLabel} />
      )}
    />
  )
}

export function PortableDeviceTool({
  op,
  input,
  result,
  toolSummary,
  isStreaming,
  isError,
}: PortableInteractiveToolProps & { op: DeviceOp }) {
  const outcome = portableResult(result)
  return (
    <DeviceToolBlockPresenter
      op={op}
      params={portableToolParams(input)}
      result={outcome.cleanResult}
      toolSummary={toolSummary}
      isStreaming={isStreaming}
      isError={isError}
      isDenied={outcome.isDenied}
      renderScreenshot={(path, label, unavailableLabel) => (
        <PortableToolScreenshot path={path} label={label} unavailableLabel={unavailableLabel} />
      )}
    />
  )
}
