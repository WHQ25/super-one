import { useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { useMobileTheme } from '../theme/context'
import { parseNativeDiff } from './diff-state'
import { monospace, tint, usePromptStyles } from './styles'

export function NativeDiff({ diff, tokens }: { diff: string; tokens?: PermissionRequest['toolDiffTokens'] }) {
  const styles = usePromptStyles()
  const { tokens: { colors } } = useMobileTheme()
  const [expanded, setExpanded] = useState(false)
  const [visibleLines, setVisibleLines] = useState(200)
  const [width, setWidth] = useState(0)
  const lines = useMemo(() => parseNativeDiff(diff, tokens), [diff, tokens])
  const gutter = Math.max(2, String(lines.reduce((max, line) => Math.max(max, line.line), 1)).length) * 7 + 12
  const code = { fontFamily: monospace, fontSize: 11, lineHeight: 17, color: colors.foreground }
  const additions = lines.filter((line) => line.kind === 'added').length
  const removals = lines.filter((line) => line.kind === 'removed').length
  return <View style={[styles.card, { padding: 0, overflow: 'hidden' }]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    <View style={[styles.row, { paddingHorizontal: 10, paddingVertical: 6 }]}>
      <Text style={[styles.meta, styles.grow]}>Changes <Text style={{ color: colors.success }}>+{additions}</Text> <Text style={{ color: colors.destructive }}>−{removals}</Text></Text>
      <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Collapse diff' : 'Expand diff'} onPress={() => setExpanded(!expanded)} hitSlop={8}><Text style={styles.meta}>{expanded ? 'Collapse' : 'Expand'}</Text></Pressable>
    </View>
    <ScrollView nestedScrollEnabled style={{ maxHeight: expanded ? 440 : 200 }}>
      <ScrollView horizontal nestedScrollEnabled><View style={{ minWidth: width, paddingVertical: 6 }}>
        {lines.slice(0, visibleLines).map((line, index) => {
          const accent = line.kind === 'added' ? colors.success : line.kind === 'removed' ? colors.destructive : colors.mutedForeground
          return <View key={index} style={{ flexDirection: 'row', backgroundColor: line.kind === 'context' ? undefined : tint(accent, '26') }}>
            <Text selectable={false} style={[code, { width: gutter, textAlign: 'right', paddingRight: 6, color: tint(colors.mutedForeground, '80'), backgroundColor: tint(colors.mutedForeground, '0d') }]}>{line.line}</Text>
            <Text selectable={false} style={[code, { width: 16, textAlign: 'center', color: accent }]}>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</Text>
            <Text selectable style={[code, { paddingRight: 12 }]}>{line.tokens?.length ? line.tokens.map(([text, color], i) => <Text key={i} style={color && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color) ? { color } : undefined}>{text}</Text>) : line.text || ' '}</Text>
          </View>
        })}
      </View></ScrollView>
    </ScrollView>
    {lines.length > visibleLines ? <Pressable accessibilityRole="button" onPress={() => setVisibleLines((count) => count + 200)} style={{ padding: 10 }}><Text style={styles.meta}>Show more lines ({lines.length - visibleLines} remaining)</Text></Pressable> : null}
  </View>
}
