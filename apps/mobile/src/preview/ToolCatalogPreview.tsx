import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Text } from '../ui/text'
import { StatusBar } from 'expo-status-bar'
import { WebView } from 'react-native-webview'
import { CHAT_VIEW_HTML } from '@superone/chat-view'
import {
  TOOL_CATALOG_CATEGORIES,
  toolCatalogExamples,
  toolCatalogMessages,
  type ToolCatalogCategory,
} from '@superone/chat-view/fixtures/tool-catalog'
import { Button, Chip } from '../ui'
import { useMobileTheme } from '../theme/context'
import { mobileWebViewTheme } from '../theme/tokens'
import { injectHostMessage } from '../native-actions'

const CHAT_SOURCE = { html: CHAT_VIEW_HTML }
const ALL = 'All' as const
type CatalogFilter = typeof ALL | ToolCatalogCategory

/**
 * Every tool row the phone can draw, hydrated into the production chat WebView.
 *
 * It renders through the same document, presenters and host protocol a paired session
 * uses, so a row that regresses here regresses on a real device — the only difference is
 * that the messages come from a fixture instead of a desktop.
 */
export function ToolCatalogPreview({ onClose, onTheme }: { onClose: () => void; onTheme: () => void }) {
  const { tokens } = useMobileTheme()
  const { fontScale } = useWindowDimensions()
  const web = useRef<WebView>(null)
  const [filter, setFilter] = useState<CatalogFilter>(ALL)
  const messages = useMemo(() => toolCatalogMessages(filter === ALL ? undefined : filter), [filter])

  const paint = () => {
    injectHostMessage(web, mobileWebViewTheme(tokens))
    injectHostMessage(web, { type: 'setViewport', fontScale, locale: 'en' })
    injectHostMessage(web, { type: 'hydrate', messages, mentionArtwork: {} })
  }
  useEffect(paint, [tokens, fontScale, messages])

  const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: tokens.colors.background },
    bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
    meta: { color: tokens.colors.mutedForeground, fontSize: 12, paddingHorizontal: 12, paddingBottom: 4 },
    // A horizontal ScrollView in a flex column claims the leftover height unless it is
    // pinned; without this the chip row grows to half the screen.
    chipBar: { flexGrow: 0, flexShrink: 0 },
    chips: { gap: 6, paddingHorizontal: 12, paddingBottom: 8, alignItems: 'center' },
    flex: { flex: 1 },
  })

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style={tokens.scheme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.bar}>
        <Button variant="ghost" label="Close catalog" onPress={onClose} />
        <View style={styles.flex} />
        <Button variant="ghost" label={tokens.scheme === 'dark' ? 'Light' : 'Dark'} onPress={onTheme} />
      </View>
      <Text testID="tool-catalog-ready" style={styles.meta}>
        {messages.length} of {toolCatalogExamples.length} tool rows · projected exactly as a paired phone receives them
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar} contentContainerStyle={styles.chips}>
        {([ALL, ...TOOL_CATALOG_CATEGORIES] as CatalogFilter[]).map((value) => (
          <Chip key={value} label={value} selected={filter === value} onPress={() => setFilter(value)} />
        ))}
      </ScrollView>
      <WebView
        ref={web}
        originWhitelist={['*']}
        source={CHAT_SOURCE}
        style={styles.flex}
        onMessage={(event) => { if (JSON.parse(event.nativeEvent.data).type === 'ready') paint() }}
      />
    </SafeAreaView>
  )
}
