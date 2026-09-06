import { useMemo } from 'react'
import { Platform, StyleSheet } from 'react-native'
import { useMobileTheme } from '../theme/context'

export const monospace = Platform.OS === 'ios' ? 'Menlo' : 'monospace'
export const tint = (color: string, opacity = '14') => `${color.slice(0, 7)}${opacity}`

export function usePromptStyles() {
  const { tokens } = useMobileTheme()
  return useMemo(() => {
    const { colors: c, spacing: s, radius: r } = tokens
    return StyleSheet.create({
      stack: { gap: s.md },
      tight: { gap: s.sm },
      row: { flexDirection: 'row', alignItems: 'center', gap: s.sm },
      wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: s.sm },
      grow: { flex: 1, minWidth: 0 },
      title: { color: c.foreground, fontSize: 14, fontWeight: '500', lineHeight: 20 },
      body: { color: c.foreground, fontSize: 14, lineHeight: 22 },
      meta: { color: c.mutedForeground, fontSize: 12, lineHeight: 18 },
      label: { color: c.mutedForeground, fontSize: 12, fontWeight: '500' },
      card: { borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, backgroundColor: c.background, borderRadius: r.md, padding: s.md, gap: s.sm },
      divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border },
      code: { fontFamily: monospace, color: c.foreground, fontSize: 12, lineHeight: 19 },
      input: { minHeight: 40, borderRadius: r.md, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: c.muted, color: c.foreground, fontSize: 13, lineHeight: 20, borderWidth: 1, borderColor: 'transparent' },
      focusedInput: { borderColor: c.primary },
      multiline: { minHeight: 64, maxHeight: 128, textAlignVertical: 'top' },
      choice: { flexDirection: 'row', alignItems: 'flex-start', gap: s.sm, paddingHorizontal: 10, paddingVertical: 10, minHeight: 44, borderRadius: r.md, borderWidth: 1, borderColor: c.border },
      selectedChoice: { borderColor: c.primary, backgroundColor: tint(c.primary) },
      choiceIcon: { marginTop: 1 },
      pill: { borderWidth: 1, borderColor: c.border, borderRadius: r.sm, paddingHorizontal: 10, paddingVertical: 7, minHeight: 44, justifyContent: 'center' },
      selectedPill: { backgroundColor: c.primary, borderColor: c.primary },
      pillText: { color: c.foreground, fontSize: 13, lineHeight: 18 },
      selectedPillText: { color: c.primaryForeground, fontWeight: '500' },
      note: { borderLeftWidth: 2, borderLeftColor: c.primary, backgroundColor: tint(c.primary), paddingHorizontal: 10, paddingVertical: 8 },
      warning: { borderWidth: 1, borderColor: tint(c.warning, '60'), backgroundColor: tint(c.warning), borderRadius: r.md, padding: 10, gap: s.xs },
      warningText: { color: c.warning, fontSize: 12, lineHeight: 18 },
      action: { flex: 1, minWidth: 0, minHeight: 44, borderRadius: r.md, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
      actionText: { fontSize: 13, lineHeight: 18, fontWeight: '500', flexShrink: 1, textAlign: 'center' },
      disabled: { opacity: 0.45 },
      pressed: { opacity: 0.75 },
      footer: { gap: s.sm },
    })
  }, [tokens])
}
