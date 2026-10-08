import { useEffect, useState } from 'react'
import { File } from 'expo-file-system'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { FILE_PREVIEW_TEXT } from '../file-preview-state'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'
import { Text } from './text'

/**
 * An offline viewer page over a file in the preview cache: the 3D model and
 * PDF previews. The page is written next to the file, so a file URL gives
 * WKWebView scoped read access to exactly that directory, and the page reads
 * the file itself. `html` carries `__VIEWER_TARGET__` (`{ uri, name }`) and the
 * `__VIEWER_BACKGROUND__` / `__VIEWER_FOREGROUND__` / `__VIEWER_SURFACE__`
 * theme colours. `zoomable` lets the page pinch-zoom as a document does.
 */
export function CachedFileViewer({ uri, name, html, testID, zoomable = false }: {
  uri: string
  name: string
  html: string
  testID: string
  zoomable?: boolean
}) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const [page, setPage] = useState<{ uri: string; directory: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPage(null)
    setError(null)
    const directory = uri.slice(0, uri.lastIndexOf('/') + 1)
    if (!uri.startsWith('file://') || !directory.startsWith('file://')) {
      setError('Preview cache file is unavailable')
      return
    }
    const pageUri = `${directory}${testID}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`
    const file = new File(pageUri)
    try {
      const target = JSON.stringify({ uri, name }).replace(/</g, '\\u003c')
      file.create()
      file.write(html
        .replace('__VIEWER_TARGET__', target)
        .replaceAll('__VIEWER_BACKGROUND__', colors.background)
        .replaceAll('__VIEWER_FOREGROUND__', colors.foreground)
        .replaceAll('__VIEWER_SURFACE__', colors.surface))
      setPage({ uri: file.uri, directory })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
    return () => { try { file.delete() } catch { /* The cache may already have been removed. */ } }
  }, [uri, name, html, testID, colors.background, colors.foreground, colors.surface])

  if (error) return <View style={styles.center}><Text accessibilityRole="alert" style={{ color: colors.error, textAlign: 'center' }}>{error}</Text></View>
  if (!page) return <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={{ color: colors.mutedForeground }}>{t(FILE_PREVIEW_TEXT.loading)}</Text></View>
  return (
    <WebView
      key={page.uri}
      testID={testID}
      source={{ uri: page.uri }}
      originWhitelist={['file://*']}
      allowingReadAccessToURL={page.directory}
      allowFileAccess
      allowFileAccessFromFileURLs
      javaScriptEnabled
      scrollEnabled={zoomable}
      bounces={false}
      overScrollMode="never"
      // Android pinch-zoom needs the built-in zoom, without its on-screen buttons.
      setBuiltInZoomControls={zoomable}
      setDisplayZoomControls={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(request) => request.url === page.uri}
      onError={(event) => setError(event.nativeEvent.description || 'Preview failed to load')}
      onContentProcessDidTerminate={() => setError('Preview stopped unexpectedly')}
      onRenderProcessGone={() => setError('Preview stopped unexpectedly')}
      style={[styles.flex, { backgroundColor: colors.background }]}
      containerStyle={{ backgroundColor: colors.background }}
    />
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
})
