import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { mermaidPreviewDocument } from '../mermaid-preview-document'
import { FILE_PREVIEW_TEXT } from '../file-preview-state'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'

/**
 * A mermaid diagram on its own page. Pinch, pan and double-tap live in this
 * WebView's document as CSS transforms — never as the chat WebView's page zoom —
 * so back leaves the transcript at 1×.
 */
export function ZoomableMermaid({ svg }: { svg: string }) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const html = useMemo(
    () => mermaidPreviewDocument(svg, colors.background),
    [svg, colors.background],
  )
  return (
    <View style={styles.stage} accessibilityLabel={t(FILE_PREVIEW_TEXT.mermaid)}>
      <WebView
        key={svg}
        originWhitelist={['*']}
        source={{ html }}
        style={[styles.flex, { backgroundColor: colors.background }]}
        containerStyle={{ backgroundColor: colors.background }}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        setBuiltInZoomControls={false}
        scalesPageToFit={false}
        javaScriptEnabled
      />
    </View>
  )
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
  flex: { flex: 1 },
})
