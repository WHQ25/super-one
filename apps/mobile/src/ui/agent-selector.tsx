import { useState } from 'react'
import { Bot, PenLine, RefreshCw } from 'lucide-react-native'
import { ActivityIndicator, Pressable } from 'react-native'
import type { RemoteAgentOption } from '@superone/shared/agent-types'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import { Text } from './text'
import { AnchoredMenu, MenuRow, useMenuAnchor } from './anchored-menu'
import { CHIP_HEIGHT, CHIP_HIT_SLOP, chipTriggerBackground } from './chip-metrics'

export function AgentSelector({ agents, value, onChange, onRefresh }: {
  agents: RemoteAgentOption[]; value: string | null; onChange: (agent: string) => void
  onRefresh?: () => Promise<void>
}) {
  const menu = useMenuAnchor()
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const label = agents.find((agent) => agent.id === value)?.name ?? value ?? t('Default agent')
  const Icon = value === 'plan' ? PenLine : Bot
  const refresh = async () => {
    if (!onRefresh || loading) return
    setLoading(true); setError('')
    try { await onRefresh() } catch { setError(t('Could not refresh agents')) }
    finally { setLoading(false) }
  }
  return <>
    <Pressable ref={menu.ref} accessibilityRole="button" accessibilityLabel={`${t('Agent')}: ${label}`}
      accessibilityState={{ expanded: !!menu.anchor }} onPress={menu.open} hitSlop={CHIP_HIT_SLOP}
      style={({ pressed }) => ({ minHeight: CHIP_HEIGHT, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4,
        borderRadius: 8, backgroundColor: chipTriggerBackground({ pressed, open: !!menu.anchor }, colors.muted) })}>
      <Icon color={colors.mutedForeground} size={14} />
      <Text numberOfLines={1} style={{ maxWidth: 160, color: colors.mutedForeground, fontSize: 12 }}>{label}</Text>
    </Pressable>
    <AnchoredMenu anchor={menu.anchor} title="Agent" onDismiss={menu.close} width={300} titleAccessory={onRefresh ? (
      <Pressable disabled={loading} accessibilityRole="button" accessibilityLabel={t('Refresh agents')} onPress={() => void refresh()}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        {loading ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RefreshCw size={15} color={colors.mutedForeground} />}
      </Pressable>
    ) : undefined}>
      {error ? <Text accessibilityRole="alert" style={{ padding: 8, color: colors.destructive }}>{error}</Text> : null}
      {agents.map((agent) => <MenuRow key={agent.id} label={agent.name} description={agent.description}
        selected={agent.id === value} onPress={() => { onChange(agent.id); menu.close() }} />)}
      {agents.length === 0 && <Text style={{ padding: 12, color: colors.mutedForeground }}>{t(loading ? 'Loading agents…' : 'No agents available')}</Text>}
    </AnchoredMenu>
  </>
}
