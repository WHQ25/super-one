import { useEffect, useState } from 'react'
import { File } from 'expo-file-system'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { MODEL_VIEWER_HTML } from '../generated-model-viewer-html'
import { FILE_PREVIEW_TEXT } from '../file-preview-state'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'
import { Text } from './text'

/** A file URL gives WKWebView scoped read access to the transferred model. */
export function ZoomableModel({ uri, name }: { uri: string; name: string }) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const [page, setPage] = useState<{ uri: string; directory: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPage(null)
    setError(null)
    const directory = uri.slice(0, uri.lastIndexOf('/') + 1)
    if (!uri.startsWith('file://') || !directory.startsWith('file://')) {
      setError('Model cache file is unavailable')
      return
    }
    const pageUri = `${directory}model-preview-${Date.now()}-${Math.random().toString(36).slice(2)}.html`
    const file = new File(pageUri)
    try {
      const target = JSON.stringify({ uri, name }).replace(/</g, '\\u003c')
      file.create()
      file.write(MODEL_VIEWER_HTML
        .replace('__MODEL_TARGET__', target)
        .replace('__MODEL_BACKGROUND__', colors.background)
        .replaceAll('__MODEL_FOREGROUND__', colors.foreground)
        .replace('__MODEL_SURFACE__', colors.surface))
      setPage({ uri: file.uri, directory })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
    return () => { try { file.delete() } catch { /* The cache may already have been removed. */ } }
  }, [uri, name, colors.background, colors.foreground, colors.surface])

  if (error) return <View style={styles.center}><Text accessibilityRole="alert" style={{ color: colors.error, textAlign: 'center' }}>{error}</Text></View>
  if (!page) return <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={{ color: colors.mutedForeground }}>{t(FILE_PREVIEW_TEXT.loading)}</Text></View>
  return (
    <WebView
      key={page.uri}
      testID="model-preview-webview"
      source={{ uri: page.uri }}
      originWhitelist={['file://*']}
      allowingReadAccessToURL={page.directory}
      allowFileAccess
      allowFileAccessFromFileURLs
      javaScriptEnabled
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      setBuiltInZoomControls={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(request) => request.url === page.uri}
      onError={(event) => setError(event.nativeEvent.description || 'Model viewer failed to load')}
      onContentProcessDidTerminate={() => setError('Model viewer stopped unexpectedly')}
      onRenderProcessGone={() => setError('Model viewer stopped unexpectedly')}
      style={[styles.flex, { backgroundColor: colors.background }]}
      containerStyle={{ backgroundColor: colors.background }}
    />
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
})
