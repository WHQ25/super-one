import { useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { Text } from '../ui/text'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import { usePromptStyles } from './styles'

export function Disclosure({ title, children, initiallyOpen = false }: { title: string; children: ReactNode; initiallyOpen?: boolean }) {
  const [expanded, setExpanded] = useState(initiallyOpen)
  const styles = usePromptStyles()
  const { tokens } = useMobileTheme()
  const { t } = useMobileLocale()
  const Icon = expanded ? ChevronDown : ChevronRight
  return <View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={[styles.row, { minHeight: 30 }]}><Icon size={14} color={tokens.colors.mutedForeground} /><Text style={styles.meta}>{t(title)}</Text></Pressable>
    {expanded ? children : null}
  </View>
}
