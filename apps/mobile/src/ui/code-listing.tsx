import { useEffect, useMemo, useRef } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { monospace, tint } from '../prompts/styles'
import { useMobileTheme } from '../theme/context'
import { highlightLines } from './code-highlight'
import { Text } from './text'

/** Line height of one code row; the anchor scroll is computed from it. */
const CODE_LINE_HEIGHT = 19

/**
 * A numbered listing that scrolls both ways. One `Text` per row rather than a
 * single block, so the cited line can carry its own background and the gutter
 * can stay aligned with wrapped-off long lines — the horizontal scroller means
 * rows never wrap, which is what keeps the two columns in step. Tokens are
 * nested `Text` runs inside the row, coloured from the GitHub palette that
 * matches the current scheme.
 */
export function CodeListing({ text, name, line, topInset }: { text: string; name: string; line?: number; topInset: number }) {
  const { tokens: { colors, scheme } } = useMobileTheme()
  const scrollRef = useRef<ScrollView>(null)
  const lines = useMemo(() => highlightLines(text, name, scheme), [text, name, scheme])
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
    <ScrollView ref={scrollRef} style={[styles.flex, { marginTop: topInset }]} contentContainerStyle={{ paddingBottom: 24 }}>
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
                <Text selectable style={[styles.code, { color: colors.foreground }]}>
                  {row.length === 0
                    ? ' '
                    : row.map((span, spanIndex) => (
                      <Text
                        key={spanIndex}
                        style={span.color || span.bold || span.italic
                          ? {
                            ...(span.color ? { color: span.color } : {}),
                            ...(span.bold ? { fontWeight: '700' as const } : {}),
                            ...(span.italic ? { fontStyle: 'italic' as const } : {}),
                          }
                          : undefined}
                      >
                        {span.text}
                      </Text>
                    ))}
                </Text>
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
  row: { flexDirection: 'row', paddingRight: 16 },
  code: { fontFamily: monospace, fontSize: 12, lineHeight: CODE_LINE_HEIGHT },
  gutter: { textAlign: 'right', paddingLeft: 8, paddingRight: 8, opacity: 0.7 },
})
