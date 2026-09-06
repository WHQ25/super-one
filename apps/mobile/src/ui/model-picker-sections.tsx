import { Switch, View } from 'react-native'
import { Text } from './text'
import type { RemoteAgentOption, RemoteModeOption, RemoteProviderOption } from '@superone/shared/agent-types'
import type { SelectorCatalogParam } from '../model-picker-state'
import { useMobileTheme } from '../theme/context'
import { MenuDisclosureRow, MenuRow, MenuSeparator } from './anchored-menu'
import { ProviderBrand } from './provider-brand'

/** The sections the model picker stacks around model + effort, in desktop order. */

export function SectionLabel({ children }: { children: string }) {
  const { tokens: { colors } } = useMobileTheme()
  return <Text style={{ paddingHorizontal: 8, paddingTop: 6, paddingBottom: 2, fontSize: 12, color: colors.mutedForeground }}>{children}</Text>
}

export function ModeSection({ label, modes, selected, locked, expanded, onExpand, onSelect }: {
  label: string; modes: RemoteModeOption[]; selected: string | null; locked?: boolean
  expanded: boolean; onExpand: () => void; onSelect: (id: string) => void
}) {
  const current = modes.find((mode) => mode.id === selected)
  if (expanded) {
    return <>
      <SectionLabel>{label}</SectionLabel>
      {modes.map((mode) => <MenuRow key={mode.id} label={mode.name} description={mode.description}
        selected={mode.id === selected} disabled={mode.disabled} onPress={() => onSelect(mode.id)} />)}
    </>
  }
  return <>
    <SectionLabel>{locked ? `${label} · locked` : label}</SectionLabel>
    <MenuDisclosureRow label={current?.name ?? label} description={locked ? 'This session has already started' : current?.description}
      disabled={locked} onPress={onExpand} />
    <MenuSeparator />
  </>
}

export function AgentSection({ agents, selected, expanded, onExpand, onSelect, disabledReason }: {
  agents: RemoteAgentOption[]; selected: string | null; expanded: boolean
  onExpand: () => void; onSelect: (id: string) => void; disabledReason?: string
}) {
  const current = agents.find((agent) => agent.id === selected)
  if (expanded) {
    return <>
      <SectionLabel>Agent</SectionLabel>
      {agents.map((agent) => <MenuRow key={agent.id} label={agent.name} description={agent.description}
        selected={agent.id === selected} onPress={() => onSelect(agent.id)} />)}
    </>
  }
  return <>
    <SectionLabel>Agent</SectionLabel>
    <MenuDisclosureRow label={current?.name ?? 'Agent'} description={disabledReason ?? current?.description}
      disabled={!!disabledReason} onPress={onExpand} />
    <MenuSeparator />
  </>
}

export function ProviderSection({ providers, selected, expanded, onExpand, onSelect }: {
  providers: RemoteProviderOption[]; selected: string | null; expanded: boolean
  onExpand: () => void; onSelect: (id: string | null) => void
}) {
  const current = providers.find((provider) => provider.id === selected) ?? providers[0]
  if (expanded) {
    return <>
      <SectionLabel>Provider</SectionLabel>
      {providers.map((provider) => <MenuRow key={provider.id ?? '__default__'} label={provider.name}
        labelNode={<ProviderBrand brandKey={provider.brand} name={provider.name} size={15} />}
        description={provider.keyName}
        selected={(provider.id ?? null) === (selected ?? null)} onPress={() => onSelect(provider.id)} />)}
    </>
  }
  return <>
    <MenuSeparator />
    <SectionLabel>Provider</SectionLabel>
    <MenuDisclosureRow label={current?.name ?? 'Default'} description={current?.keyName} onPress={onExpand} />
  </>
}

export function OptionsSection({ params, onChange }: {
  params: SelectorCatalogParam[]; onChange: (id: string, value: string) => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const toggles = params.filter((param) => param.kind === 'toggle')
  const choices = params.filter((param) => param.kind === 'choice')
  if (!params.length) return null
  return <>
    {toggles.length ? <>
      <MenuSeparator />
      <SectionLabel>Options</SectionLabel>
      {toggles.map((param) => <View key={param.id} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center',
        justifyContent: 'space-between', gap: 12, paddingHorizontal: 8, borderRadius: radius.sm }}>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '500', color: colors.foreground }}>{param.label}</Text>
        <Switch value={param.selected === 'true'} accessibilityLabel={param.label}
          onValueChange={(enabled) => onChange(param.id, enabled ? 'true' : 'false')} />
      </View>)}
    </> : null}
    {choices.map((param) => <View key={param.id}>
      <MenuSeparator />
      <SectionLabel>{param.label}</SectionLabel>
      {param.values.map((value) => <MenuRow key={value.value} label={value.label}
        selected={value.value === param.selected} onPress={() => onChange(param.id, value.value)} />)}
    </View>)}
  </>
}
