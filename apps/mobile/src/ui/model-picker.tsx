import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native'
import { Text } from './text'
import { ChevronDown, RefreshCw, Search, X, Zap } from 'lucide-react-native'
import type {
  HarnessId,
  ModelOption,
  RemoteActiveProvider,
  RemoteAgentOption,
  RemoteEffortOption,
  RemoteModeOption,
  RemoteProviderOption,
} from '@superone/shared/agent-types'
import { useMobileTheme } from '../theme/context'
import { harnessDisplayName } from '../provider-state'
import { AnchoredMenu, MenuDisclosureRow, MenuRow, MenuSeparator, useMenuAnchor } from './anchored-menu'
import { EffortSlider } from './effort-slider'
import { FireText, RainbowText } from './effort-easter-egg'
import { AgentSection, ModeSection, OptionsSection, ProviderSection, SectionLabel } from './model-picker-sections'
import {
  effortEasterEgg,
  groupModels,
  hasSelectableEffort,
  keepsOpenAfterModelSelect,
  optionParamSummary,
  type SelectorCatalogParam,
} from '../model-picker-state'

export type ModelPickerProps = {
  harness: HarnessId; models: ModelOption[]; model: string; onModel: (model: string) => void
  efforts: RemoteEffortOption[]; effort: string; onEffort: (effort: string) => void
  /** OpenCode primary agents. */
  agents?: RemoteAgentOption[]; agent?: string | null; onAgent?: (agent: string) => void
  agentDisabledReason?: string
  /** ACP session modes / DeepSeek presets — a discrete pick, not effort. */
  modes?: RemoteModeOption[]; mode?: string | null; modeLabel?: string; modesLocked?: boolean
  onMode?: (mode: string) => void
  /** Codex Fast and harness-native catalog params. */
  optionParams?: SelectorCatalogParam[]; onOptionParam?: (id: string, value: string) => void
  /** Credentials / accounts this harness can run on. */
  providers?: RemoteProviderOption[]; providerId?: string | null; onProvider?: (id: string | null) => void
  providerName?: string; activeProvider?: RemoteActiveProvider | null; acpAgentId?: string | null
  disabled?: boolean; compact?: boolean
  onRefresh?: () => Promise<void>
}

type Section = 'models' | 'agents' | 'modes' | 'providers' | null

/** Model, effort and every harness-native catalog in one control, like the desktop selector. */
export function ModelPicker(props: ModelPickerProps) {
  const menu = useMenuAnchor()
  const { tokens: { colors } } = useMobileTheme()
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [expanded, setExpanded] = useState<Section>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const selected = props.models.find((model) => model.id === props.model)
  const modelLabel = selected?.name || props.model || 'Choose model'
  const canSelectEffort = hasSelectableEffort(props.efforts)
  const effortLabel = props.efforts.find((effort) => effort.value === props.effort)?.label ?? 'Effort'
  const agents = props.agents ?? []
  const modes = props.modes ?? []
  const optionParams = props.optionParams ?? []
  const providers = props.providers ?? []
  const agentLabel = agents.find((agent) => agent.id === props.agent)?.name
  const summary = optionParamSummary(optionParams)
  const fastEnabled = optionParams.some((param) => param.id === 'fast' && param.selected === 'true')
  // Effort and the catalogs own the menu body until a list is asked for.
  const hasSideOptions = canSelectEffort || optionParams.length > 0 || modes.length > 0 || agents.length > 0
  const listOpen = expanded === 'models' || !hasSideOptions
  const searchAvailable = listOpen && props.models.length > 10
  const collapsed = expanded === null
  const groups = useMemo(
    () => groupModels(props.models, {
      harness: props.harness, providerName: props.providerName, query, acpAgentId: props.acpAgentId,
    }),
    [props.models, props.harness, props.providerName, props.acpAgentId, query],
  )
  const collapse = () => { setExpanded(null); setSearchOpen(false); setQuery('') }
  const close = () => { collapse(); menu.close() }
  const info = { models: props.models, efforts: props.efforts, activeProvider: props.activeProvider ?? null }
  const selectModel = (id: string) => {
    props.onModel(id)
    if (hasSideOptions || keepsOpenAfterModelSelect(props.harness, info, id)) collapse()
    else close()
  }
  const refresh = async () => {
    if (!props.onRefresh || loading) return
    setLoading(true); setError('')
    try { await props.onRefresh() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not refresh models') }
    finally { setLoading(false) }
  }
  // Claude's two effort easter eggs replace the whole trigger, as on desktop.
  const eggLabel = `${modelLabel.toUpperCase()} · ${props.effort === 'max' ? 'MAX' : 'ULTRATHINK'}`
  const egg = effortEasterEgg(props.harness, props.effort, props.efforts)
  // Shrink weights mirror the desktop trigger: the model name is the last thing
  // to be truncated, agent next, effort and option summaries give way first.
  const triggerParts: Array<{ text: string; shrink: number }> = [
    ...(agentLabel ? [{ text: agentLabel, shrink: 8 }] : []),
    { text: modelLabel, shrink: 1 },
    ...(canSelectEffort ? [{ text: effortLabel, shrink: 64 }] : []),
    ...summary.slice(0, 2).map((text) => ({ text, shrink: 32 })),
  ]
  return <>
    <Pressable ref={menu.ref} disabled={props.disabled} accessibilityRole="button"
      accessibilityLabel={`Model: ${egg ? eggLabel : triggerParts.map((part) => part.text).join(', ')}`}
      accessibilityState={{ disabled: props.disabled, expanded: !!menu.anchor }} onPress={() => { collapse(); menu.open() }}
      style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: props.compact ? 6 : 12,
        borderRadius: 8, opacity: props.disabled ? 0.45 : 1, backgroundColor: pressed ? colors.muted : 'transparent' })}>
      <View style={props.compact ? { maxWidth: 260 } : { flex: 1 }}>
        {!props.compact ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Model</Text> : null}
        {/* Truncation priority follows desktop: effort and options give way long before the model name. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {egg === 'max' ? <FireText fontSize={props.compact ? 12 : 15}>{eggLabel}</FireText> : null}
          {egg === 'xhigh' ? <RainbowText fontSize={props.compact ? 12 : 15}>{eggLabel}</RainbowText> : null}
          {!egg && fastEnabled ? <Zap size={props.compact ? 11 : 13} color={colors.mutedForeground} fill={colors.mutedForeground} /> : null}
          {!egg && triggerParts.map((part, index) => <View key={`${part.text}-${index}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: part.shrink, minWidth: 0 }}>
            {index > 0 ? <Text style={{ fontSize: props.compact ? 12 : 15, color: colors.mutedForeground, opacity: 0.7 }}>·</Text> : null}
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: props.compact ? 12 : 15, color: props.compact ? colors.mutedForeground : colors.foreground }}>{part.text}</Text>
          </View>)}
        </View>
      </View>
      <ChevronDown size={12} color={colors.mutedForeground} style={{ transform: [{ rotate: menu.anchor ? '180deg' : '0deg' }] }} />
    </Pressable>
    <AnchoredMenu anchor={menu.anchor} title="Models" onDismiss={close} width={320} titleAccessory={
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, color: colors.mutedForeground }}>
          {props.providerName || harnessDisplayName(props.harness)}
        </Text>
        {props.onRefresh ? <Pressable disabled={loading} accessibilityRole="button" accessibilityLabel="Refresh models" onPress={() => { void refresh() }}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          {loading ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RefreshCw size={15} color={colors.mutedForeground} />}
        </Pressable> : null}
        {searchAvailable ? <Pressable accessibilityRole="button" accessibilityLabel={searchOpen ? 'Close search' : 'Search models'}
          onPress={() => { setQuery(''); setSearchOpen(!searchOpen) }}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          {searchOpen ? <X size={15} color={colors.mutedForeground} /> : <Search size={15} color={colors.mutedForeground} />}
        </Pressable> : null}
      </View>
    }>
      {searchAvailable && searchOpen
        ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, borderBottomWidth: 1, borderColor: colors.border }}>
          <Search size={14} color={colors.mutedForeground} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search models…" accessibilityLabel="Search models" autoFocus autoCorrect={false}
            placeholderTextColor={colors.mutedForeground} style={{ minHeight: 44, flex: 1, fontSize: 13, color: colors.foreground }} />
        </View>
        : null}
      {error ? <Text accessibilityRole="alert" style={{ padding: 8, color: colors.destructive, fontSize: 12 }}>{error}</Text> : null}

      {modes.length && (collapsed || expanded === 'modes') && props.onMode ? <ModeSection
        label={props.modeLabel || 'Mode'} modes={modes} selected={props.mode ?? null} locked={props.modesLocked}
        expanded={expanded === 'modes'} onExpand={() => setExpanded('modes')}
        onSelect={(id) => { props.onMode?.(id); setExpanded(null) }} /> : null}

      {agents.length && (collapsed || expanded === 'agents') && props.onAgent ? <AgentSection
        agents={agents} selected={props.agent ?? null} disabledReason={props.agentDisabledReason}
        expanded={expanded === 'agents'} onExpand={() => setExpanded('agents')}
        onSelect={(id) => { props.onAgent?.(id); setExpanded(null) }} /> : null}

      {collapsed || expanded === 'models' ? <>
        {listOpen
          ? <>
            {groups.map((group) => <View key={group.name}>
              {groups.length > 1 ? <SectionLabel>{group.name}</SectionLabel> : null}
              {group.models.map((model) => <MenuRow key={model.id} label={model.name || model.id} description={model.description}
                selected={model.id === props.model} disabled={loading} onPress={() => selectModel(model.id)} />)}
            </View>)}
            {!groups.length ? <Text style={{ padding: 12, color: colors.mutedForeground, fontSize: 13 }}>
              {loading ? 'Loading models…' : query ? 'No matching models' : 'No models available'}
            </Text> : null}
          </>
          : <MenuDisclosureRow label={modelLabel} description={selected?.description} onPress={() => setExpanded('models')} />}
      </> : null}

      {collapsed && canSelectEffort ? <>
        <MenuSeparator />
        <EffortSlider label="Effort" options={props.efforts} value={props.effort} onChange={props.onEffort} disabled={loading} />
      </> : null}

      {collapsed && props.onOptionParam
        ? <OptionsSection params={optionParams} onChange={props.onOptionParam} />
        : null}

      {providers.length && (collapsed || expanded === 'providers') && props.onProvider ? <ProviderSection
        providers={providers} selected={props.providerId ?? null}
        expanded={expanded === 'providers'} onExpand={() => setExpanded('providers')}
        onSelect={(id) => { props.onProvider?.(id); setExpanded(null) }} /> : null}
    </AnchoredMenu>
  </>
}
