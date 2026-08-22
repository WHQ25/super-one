import { useCallback, useMemo, useRef, useState } from 'react'
import { useChatStore, type ToolRendererState } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useIsDark } from '@/hooks/use-is-dark'
import { handleMiniAppMessage } from '@/hooks/miniapp-message-handler'
import { MiniAppWebview, type MiniAppWebviewHandle } from '@/components/miniapp/MiniAppWebview'
import { readThemeVars } from '@/components/miniapp/miniapp-theme'
import { MiniAppToolBridgeMsg, buildToolRendererUrl } from '@superone/shared/miniapp-types'
import { buildMiniAppUrlHost } from '@superone/shared/miniapp-url'

const DEFAULT_HEIGHT = 160

interface InterceptProps {
  phase: 'intercept'
  state: ToolRendererState
}

interface ResultProps {
  phase: 'result'
  appId: string
  callId: string
  toolName: string
  templatePath: string
  result: unknown
  onClose?: () => void
}

type Props = InterceptProps | ResultProps

export function ToolRendererFrame(props: Props) {
  const webviewRef = useRef<MiniAppWebviewHandle>(null)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const submit = useChatStore((s) => s.submitToolIntercept)
  const cancel = useChatStore((s) => s.cancelToolIntercept)
  const projectId = useAppStore((s) => s.currentProjectId)
  const projectDir = useAppStore((s) => s.currentFolder) ?? ''
  const isDark = useIsDark()
  const appId = props.phase === 'intercept' ? props.state.appId : props.appId
  const expectedCallId = props.phase === 'intercept' ? props.state.callId : props.callId

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
      submit(expectedCallId, (data.userInput as Record<string, unknown>) ?? {})
      return
    }
    if (channel === MiniAppToolBridgeMsg.CANCEL && props.phase === 'intercept' && data.callId === expectedCallId) {
      cancel(expectedCallId, data.reason as string | undefined)
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
        className="block size-full"
        style={{ border: 'none' }}
      />
    </div>
  )
}
