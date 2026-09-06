import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native'
import { Text } from './text'
import { ChevronDown, RefreshCw, Search } from 'lucide-react-native'
import type { HarnessId, ModelOption, RemoteEffortOption } from '@superone/shared/agent-types'
import { useMobileTheme } from '../theme/context'
import { harnessDisplayName } from '../provider-state'
import { AnchoredMenu, MenuRow, MenuSeparator, useMenuAnchor } from './anchored-menu'

export type ModelPickerProps = {
  harness: HarnessId; models: ModelOption[]; model: string; onModel: (model: string) => void
  efforts: RemoteEffortOption[]; effort: string; onEffort: (effort: string) => void
  providerName?: string; disabled?: boolean; compact?: boolean; combined?: boolean
  onRefresh?: () => Promise<void>
}

export function ModelPicker(props: ModelPickerProps) {
  const menu = useMenuAnchor()
  const { tokens: { colors } } = useMobileTheme()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const selected = props.models.find((model) => model.id === props.model)
  const modelLabel = selected?.name || props.model || 'Choose model'
  const effortLabel = props.efforts.find((effort) => effort.value === props.effort)?.label
  const groups = useMemo(() => {
    const result = new Map<string, ModelOption[]>()
    const search = query.trim().toLowerCase()
    for (const model of props.models) {
      if (search && !`${model.name} ${model.id} ${model.description}`.toLowerCase().includes(search)) continue
      const prefix = props.harness === 'opencode' && model.id.includes('/') ? model.id.split('/')[0]! : props.providerName || harnessDisplayName(props.harness)
      const rows = result.get(prefix) ?? []
      rows.push(model); result.set(prefix, rows)
    }
    return [...result]
  }, [props.models, props.harness, props.providerName, query])
  const refresh = async () => {
    if (!props.onRefresh || loading) return
    setLoading(true); setError('')
    try { await props.onRefresh() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not refresh models') }
    finally { setLoading(false) }
  }
  return <>
    <Pressable ref={menu.ref} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={`Model: ${modelLabel}`}
      accessibilityState={{ disabled: props.disabled, expanded: !!menu.anchor }} onPress={() => { setQuery(''); menu.open() }}
      style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: props.compact ? 6 : 12,
        borderRadius: 8, opacity: props.disabled ? 0.45 : 1, backgroundColor: pressed ? colors.muted : 'transparent' })}>
      <View style={props.compact ? { maxWidth: props.combined ? 240 : 180 } : { flex: 1 }}>
        {!props.compact ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Model</Text> : null}
        <Text numberOfLines={1} style={{ fontSize: props.compact ? 12 : 15, color: props.compact ? colors.mutedForeground : colors.foreground }}>
          {modelLabel}{props.combined && effortLabel ? ` · ${effortLabel}` : ''}
        </Text>
      </View>
      <ChevronDown size={12} color={colors.mutedForeground} style={{ transform: [{ rotate: menu.anchor ? '180deg' : '0deg' }] }} />
    </Pressable>
    <AnchoredMenu anchor={menu.anchor} title="Model" onDismiss={menu.close} width={320}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 8 }}>
        <Text style={{ flex: 1, fontSize: 12, color: colors.mutedForeground }}>{props.providerName || harnessDisplayName(props.harness)}</Text>
        {props.onRefresh ? <Pressable disabled={loading} accessibilityRole="button" accessibilityLabel="Refresh models" onPress={() => { void refresh() }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          {loading ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RefreshCw size={15} color={colors.mutedForeground} />}
        </Pressable> : null}
      </View>
      {props.models.length > 10 ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, borderBottomWidth: 1, borderColor: colors.border }}>
        <Search size={14} color={colors.mutedForeground} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search models…" accessibilityLabel="Search models" autoCorrect={false}
          placeholderTextColor={colors.mutedForeground} style={{ minHeight: 44, flex: 1, fontSize: 13, color: colors.foreground }} />
      </View> : null}
      {error ? <Text accessibilityRole="alert" style={{ padding: 8, color: colors.destructive, fontSize: 12 }}>{error}</Text> : null}
      {groups.map(([group, models]) => <View key={group}>
        {groups.length > 1 ? <Text style={{ padding: 8, color: colors.mutedForeground, fontSize: 12 }}>{group}</Text> : null}
        {models.map((model) => <MenuRow key={model.id} label={model.name || model.id} description={model.description} selected={model.id === props.model} disabled={loading}
          onPress={() => { props.onModel(model.id); if (!(model.supportedEffortLevels?.length || model.supportedReasoningEfforts?.length || props.harness === 'acp' && props.efforts.length)) menu.close() }} />)}
      </View>)}
      {!groups.length ? <Text style={{ padding: 12, color: colors.mutedForeground, fontSize: 13 }}>{loading ? 'Loading models…' : query ? 'No matching models' : 'No models available'}</Text> : null}
      {props.efforts.length ? <>
        <MenuSeparator />
        <Text style={{ padding: 8, fontSize: 12, color: colors.mutedForeground }}>{props.harness === 'codex' ? 'Reasoning effort' : 'Effort'}</Text>
        {props.efforts.map((effort) => <MenuRow key={effort.value} label={effort.label} description={effort.description} selected={effort.value === props.effort} disabled={loading}
          onPress={() => { props.onEffort(effort.value); menu.close() }} />)}
      </> : null}
    </AnchoredMenu>
  </>
}
