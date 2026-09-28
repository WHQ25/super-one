import { useCallback, useMemo, useRef, useState } from 'react'
import { useChatStore, type ToolRendererState } from '@/stores/chat'
import { useIsDark } from '@/hooks/use-is-dark'
import { handleMiniAppMessage } from '@/hooks/miniapp-message-handler'
import { MiniAppWebview, type MiniAppWebviewHandle } from '@/components/miniapp/MiniAppWebview'
import type { MiniAppTargetRegistration } from '@/components/miniapp/miniapp-automation-targets'
import { readThemeVars } from '@/components/miniapp/miniapp-theme'
import { MiniAppToolBridgeMsg, buildToolRendererUrl } from '@superone/shared/miniapp-types'
import { buildMiniAppUrlHost } from '@superone/shared/miniapp-url'
import { useMiniAppProjectScope, useMiniAppToolTarget } from '@/components/miniapp/use-miniapp-project-scope'

const DEFAULT_HEIGHT = 160

type AutomationTarget = Omit<MiniAppTargetRegistration, 'appId'>

interface InterceptProps {
  phase: 'intercept'
  state: ToolRendererState
  /** Replace the chat-store submit/cancel, e.g. to record them in a preview. */
  onSubmit?: (userInput: Record<string, unknown>) => void
  onCancel?: (reason: string | undefined) => void
  automation?: AutomationTarget
}

interface ResultProps {
  phase: 'result'
  appId: string
  callId: string
  toolName: string
  templatePath: string
  result: unknown
  onClose?: () => void
  automation?: AutomationTarget
}

type Props = InterceptProps | ResultProps

export function ToolRendererFrame(props: Props) {
  const webviewRef = useRef<MiniAppWebviewHandle>(null)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const submit = useChatStore((s) => s.submitToolIntercept)
  const cancel = useChatStore((s) => s.cancelToolIntercept)
  const { projectDir, projectId } = useMiniAppProjectScope()
  const isDark = useIsDark()
  const appId = props.phase === 'intercept' ? props.state.appId : props.appId
  const expectedCallId = props.phase === 'intercept' ? props.state.callId : props.callId
  const toolName = props.phase === 'intercept' ? props.state.toolName : props.toolName
  const toolUseId = props.phase === 'intercept' ? (props.state.toolUseId ?? props.state.callId) : props.callId
  const automation = useMiniAppToolTarget(appId, toolUseId, `${toolName} (${props.phase})`, projectDir, props.automation)

  const src = useMemo(
    () => props.phase === 'intercept'
      ? props.state.templateUrl
      : buildToolRendererUrl('result', buildMiniAppUrlHost(props.appId, projectId), props.templatePath, props.callId, props.toolName, props.result),
    [props, projectId],
  )

  const handleMessage = useCallback((channel: string, data: Record<string, unknown>, send: (message: unknown) => void) => {
    if (channel === 'miniapp-ready') {
      send({ type: 'miniapp-theme', vars: readThemeVars(), isDark })
      return
    }
    if (channel === MiniAppToolBridgeMsg.SUBMIT && props.phase === 'intercept' && data.callId === expectedCallId) {
      const userInput = (data.userInput as Record<string, unknown>) ?? {}
      if (props.onSubmit) props.onSubmit(userInput)
      else submit(expectedCallId, userInput)
      return
    }
    if (channel === MiniAppToolBridgeMsg.CANCEL && props.phase === 'intercept' && data.callId === expectedCallId) {
      const reason = data.reason as string | undefined
      if (props.onCancel) props.onCancel(reason)
      else cancel(expectedCallId, reason)
      return
    }
    if (channel === MiniAppToolBridgeMsg.RESULT_CLOSE && props.phase === 'result' && data.callId === expectedCallId) {
      props.onClose?.()
      return
    }
    if (channel === 'miniapp-resize' && typeof data.height === 'number' && data.height > 0) {
      setHeight(data.height)
      return
    }
    if (projectDir) handleMiniAppMessage(channel, data, appId, projectDir, send)
  }, [appId, cancel, expectedCallId, isDark, projectDir, props, submit])

  return (
    <div className="w-full overflow-hidden rounded-md border border-border" style={{ height }}>
      <MiniAppWebview
        ref={webviewRef}
        appId={appId}
        src={src}
        onMessage={handleMessage}
        automation={automation}
        className="block size-full"
        style={{ border: 'none' }}
      />
    </div>
  )
}
