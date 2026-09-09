import { useEffect, useMemo, useRef } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { CircleAlert, FileDown } from 'lucide-react-native'
import { FILE_PREVIEW_TEXT, type FilePreviewState } from '../file-preview-state'
import { formatFileSize } from '../shared-file-state'
import { NativeMarkdown } from '../prompts/NativeMarkdown'
import { monospace, tint } from '../prompts/styles'
import { Text } from '../ui/text'
import { Button } from '../ui/primitives'
import { SCROLL_INDICATOR_GUTTER } from '../ui/scroll-gutter'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'

export type FilePreviewScreenProps = {
  state: FilePreviewState
  /** Start (or approve) the download that the page could not render inline. */
  onStartTransfer: () => void
  onRetry: () => void
}

/** Line height of one code row; the anchor scroll is computed from it. */
const CODE_LINE_HEIGHT = 19

/**
 * The phone's stand-in for the desktop's `FilePreview` tab.
 *
 * It renders what `read_desktop_file` can return in-band — small text, with
 * Markdown as prose and everything else as a numbered listing anchored on the
 * cited line. A file that did not come back inline is shown as a transfer
 * card instead: its name and size, and over the relay a Download button, because
 * moving those bytes stages an encrypted copy on the relay first and the user
 * should see that before it happens. Over the LAN the transfer starts on its own.
 */
export function FilePreviewScreen({ state, onStartTransfer, onRetry }: FilePreviewScreenProps) {
  const { tokens: { colors, spacing } } = useMobileTheme()
  const { t } = useMobileLocale()

  if (state.kind === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{t(FILE_PREVIEW_TEXT.loading)}</Text>
      </View>
    )
  }

  if (state.kind === 'error') {
    return (
      <View style={[styles.center, { paddingHorizontal: spacing.lg }]}>
        <CircleAlert color={colors.error} size={28} />
        <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 13, textAlign: 'center' }}>{state.message}</Text>
        <Button label={FILE_PREVIEW_TEXT.retry} variant="secondary" onPress={onRetry} />
      </View>
    )
  }

  if (state.kind === 'transfer') {
    return (
      <View style={[styles.center, { paddingHorizontal: spacing.lg }]}>
        <FileDown color={colors.primary} size={28} />
        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '500', textAlign: 'center' }}>{state.name}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{formatFileSize(state.size)} · {state.mimeType}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>
          {t(state.needsConfirm ? FILE_PREVIEW_TEXT.relayNotice : FILE_PREVIEW_TEXT.lanNotice)}
        </Text>
        {state.started
          ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t(FILE_PREVIEW_TEXT.downloading)}</Text>
          : state.needsConfirm
            ? <Button label={FILE_PREVIEW_TEXT.download} icon={FileDown} onPress={onStartTransfer} />
            : null}
      </View>
    )
  }

  if (state.markdown) {
    return (
      <ScrollView style={styles.flex}
        contentContainerStyle={{ padding: spacing.md, paddingRight: SCROLL_INDICATOR_GUTTER + spacing.md, paddingBottom: spacing.xl }}>
        <NativeMarkdown content={state.text} />
      </ScrollView>
    )
  }

  return <CodeListing text={state.text} line={state.line} />
}

/**
 * A numbered listing that scrolls both ways. One `Text` per row rather than a
 * single block, so the cited line can carry its own background and the gutter
 * can stay aligned with wrapped-off long lines — the horizontal scroller means
 * rows never wrap, which is what keeps the two columns in step.
 */
function CodeListing({ text, line }: { text: string; line?: number }) {
  const { tokens: { colors } } = useMobileTheme()
  const scrollRef = useRef<ScrollView>(null)
  const lines = useMemo(() => {
    const rows = text.split('\n')
    // A trailing newline is a line terminator, not an empty last line.
    if (rows.length > 1 && rows[rows.length - 1] === '') rows.pop()
    return rows
  }, [text])
  const gutterWidth = `${lines.length}`.length

  // Anchor on the cited line once the rows exist; a few rows of context above
  // it keep the highlighted row from sitting flush against the header.
  useEffect(() => {
    if (line == null || line < 1) return
    const target = Math.max(0, line - 4) * CODE_LINE_HEIGHT
    const handle = setTimeout(() => scrollRef.current?.scrollTo({ y: target, animated: false }), 0)
    return () => clearTimeout(handle)
  }, [line, lines.length])

  return (
    <ScrollView ref={scrollRef} style={styles.flex} contentContainerStyle={{ paddingBottom: 24 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
        <View>
          {lines.map((row, index) => {
            const number = index + 1
            const highlighted = number === line
            return (
              <View
                key={number}
                testID={highlighted ? 'file-preview-cited-line' : undefined}
                style={[styles.row, highlighted && { backgroundColor: tint(colors.primary, '22') }]}
              >
                <Text selectable={false} style={[styles.code, styles.gutter, { color: colors.mutedForeground, width: gutterWidth * 8 + 16 }]}>
                  {`${number}`.padStart(gutterWidth, ' ')}
                </Text>
                <Text selectable style={[styles.code, { color: colors.foreground }]}>{row.length ? row : ' '}</Text>
              </View>
            )
          })}
        </View>
      </ScrollView>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  row: { flexDirection: 'row', paddingRight: 16 },
  code: { fontFamily: monospace, fontSize: 12, lineHeight: CODE_LINE_HEIGHT },
  gutter: { textAlign: 'right', paddingLeft: 8, paddingRight: 8, opacity: 0.7 },
})
