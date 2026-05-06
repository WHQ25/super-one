import { useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore, type ToolRendererState } from '@/stores/chat'
import { MiniAppToolBridgeMsg, buildToolRendererUrl } from '@superone/shared/miniapp-types'

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
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)

  const submit = useChatStore((s) => s.submitToolIntercept)
  const cancel = useChatStore((s) => s.cancelToolIntercept)

  const src = useMemo(
    () => props.phase === 'intercept'
      ? props.state.templateUrl
      : buildToolRendererUrl('result', props.appId, props.templatePath, props.callId, props.toolName, props.result),
    [props],
  )
  const expectedCallId = props.phase === 'intercept' ? props.state.callId : props.callId
  const onCloseRef = useRef<(() => void) | undefined>(props.phase === 'result' ? props.onClose : undefined)
  onCloseRef.current = props.phase === 'result' ? props.onClose : undefined
  const phaseRef = useRef(props.phase)
  phaseRef.current = props.phase

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!iframeRef.current || ev.source !== iframeRef.current.contentWindow) return
      const data = ev.data as { type?: string; callId?: string; userInput?: Record<string, unknown>; reason?: string; height?: number }
      if (!data || typeof data.type !== 'string') return

      switch (data.type) {
        case MiniAppToolBridgeMsg.SUBMIT:
          if (phaseRef.current === 'intercept' && data.callId === expectedCallId) {
            submit(expectedCallId, data.userInput ?? {})
          }
          break
        case MiniAppToolBridgeMsg.CANCEL:
          if (phaseRef.current === 'intercept' && data.callId === expectedCallId) {
            cancel(expectedCallId, data.reason ?? undefined)
          }
          break
        case MiniAppToolBridgeMsg.RESULT_CLOSE:
          if (phaseRef.current === 'result' && data.callId === expectedCallId) {
            onCloseRef.current?.()
          }
          break
        case 'miniapp-resize':
          if (typeof data.height === 'number' && data.height > 0) {
            setHeight(data.height)
          }
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [expectedCallId, submit, cancel])

  return (
    <iframe
      ref={iframeRef}
      src={src}
      sandbox="allow-scripts allow-same-origin"
      className="w-full rounded-md border border-border"
      style={{ height }}
    />
  )
}
