import type { RefObject } from 'react'
import type { WebView } from 'react-native-webview'
import { TerminalScreen } from '../screens/terminal-screen'
import type { TerminalRuntime } from '../terminal-runtime'
import type { MobileWebViewTheme } from '../theme/tokens'
import { injectHostMessage } from '../native-actions'
import { runUiAction } from '../ui-action'

export function ConnectedTerminal(props: {
  webRef: RefObject<WebView | null>; runtimeRef: RefObject<TerminalRuntime | null>
  theme: MobileWebViewTheme; draft: string; writable: boolean
  onDraft: (value: string) => void; onStatus: (value: string) => void
}) {
  return <TerminalScreen webRef={props.webRef} draft={props.draft} writable={props.writable}
    onWebMessage={(raw) => {
      try {
        if (JSON.parse(raw).type === 'terminalReady') injectHostMessage(props.webRef, props.theme)
      } catch { /* Runtime handles malformed terminal messages. */ }
      props.runtimeRef.current?.handleViewMessage(raw)
    }}
    onDraft={props.onDraft}
    onSubmit={(line) => runUiAction(() => { props.runtimeRef.current?.input(`${line}\n`); props.onDraft('') }, props.onStatus, 'terminal input failed')}
    onClaim={() => runUiAction(() => props.runtimeRef.current?.claim(), props.onStatus, 'terminal claim failed')}
    onKey={(data) => runUiAction(() => props.runtimeRef.current?.input(data), props.onStatus, 'terminal input failed')}
  />
}
