import { useEffect, useRef, useState, type ReactNode } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { CHAT_VIEW_HTML, type HostOutbound } from '@superone/chat-view'
import { chatViewModeScript } from '@superone/chat-view/view-mode'
import { useMobileLocale } from '../i18n/context'
import { resolveMarkdownDocumentRequest, type MarkdownDocumentPorts } from '../markdown-document-requests'
import { injectHostMessage } from '../native-actions'
import { chatViewPrePaintScript, hostMessageIsReady } from '../screens/chat-webview-boot'
import { createChatWebViewChannel } from '../screens/chat-webview-channel'
import { parentRemotePath } from '../shell-state'
import { useMobileTheme } from '../theme/context'
import { mobileWebViewTheme } from '../theme/tokens'

const SOURCE = { html: CHAT_VIEW_HTML }

/**
 * A Markdown file rendered by the chat WebView's own pipeline in its
 * `markdown-document` mode, so mermaid, math, highlighted code, tables and
 * host images read as they do in the transcript and on the desktop.
 *
 * Mount it as soon as the file is known to be Markdown, before `text` has
 * arrived: the renderer then boots while the host is still reading the file.
 * `placeholder` covers it until the document's first frame.
 */
export function MarkdownDocumentView({ text, path, ports, placeholder }: {
  /** Absent while the file is still on its way from the host. */
  text?: string
  path: string
  ports?: MarkdownDocumentPorts
  placeholder: ReactNode
}) {
  const { tokens } = useMobileTheme()
  const { locale } = useMobileLocale()
  const { fontScale } = useWindowDimensions()
  const web = useRef<WebView>(null)
  const [ready, setReady] = useState(false)
  const [rendered, setRendered] = useState(false)
  const directory = parentRemotePath(path)
  const portsRef = useRef(ports)
  portsRef.current = ports
  // Captured on mount: changing it remounts WKWebView onto its white default.
  const boot = useRef(chatViewModeScript('markdown-document') + chatViewPrePaintScript(tokens.colors.background, tokens.scheme)).current
  const [channel] = useState(() => createChatWebViewChannel((message) => injectHostMessage(web, message)))

  useEffect(() => { if (ready) injectHostMessage(web, mobileWebViewTheme(tokens)) }, [ready, tokens])
  useEffect(() => { if (ready) injectHostMessage(web, { type: 'setViewport', fontScale, locale }) }, [ready, fontScale, locale])
  useEffect(() => {
    if (ready && text !== undefined) injectHostMessage(web, { type: 'showMarkdownDocument', text, directory })
  }, [ready, text, directory])

  return (
    <View style={styles.flex}>
      <WebView
        testID="markdown-document"
        ref={web}
        originWhitelist={['*']}
        source={SOURCE}
        injectedJavaScriptBeforeContentLoaded={boot}
        style={[styles.flex, { backgroundColor: tokens.colors.background }]}
        containerStyle={{ backgroundColor: tokens.colors.background }}
        onLoadStart={() => { channel.reset(); setReady(false); setRendered(false) }}
        onMessage={(event) => {
          const raw = channel.receive(event.nativeEvent.data)
          if (raw === null) return
          if (hostMessageIsReady(raw)) { setReady(true); return }
          const message = JSON.parse(raw) as HostOutbound
          if (message.type === 'documentRendered') { setRendered(true); return }
          if (message.type !== 'requestNative') return
          void resolveMarkdownDocumentRequest(message, portsRef.current, directory)
            .then((result) => injectHostMessage(web, result))
        }}
        onContentProcessDidTerminate={() => web.current?.reload()}
        onRenderProcessGone={() => web.current?.reload()}
      />
      {rendered ? null : <View style={[StyleSheet.absoluteFill, { backgroundColor: tokens.colors.background }]}>{placeholder}</View>}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
})
