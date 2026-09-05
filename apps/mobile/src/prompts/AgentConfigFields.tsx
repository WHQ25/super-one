import { useEffect, useRef, useState } from 'react'
import { Text, View } from 'react-native'
import type { HarnessId, RemoteSystemInfo, SessionAgentLaunchConfig, SessionAgentProfile } from '@superone/shared/agent-types'
import { findCodexFastServiceTier } from '@superone/shared/codex-fast-mode'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import { permissionModeLabel } from '../ui/permission-mode-selector'
import { EditableField, SelectField } from './EditableField'
import { usePromptStyles } from './styles'

export function AgentConfigFields({ harness, config, profile: suppliedProfile, loadSystemInfo, onChange }: { harness: HarnessId; config: SessionAgentLaunchConfig; profile?: SessionAgentProfile; loadSystemInfo?: (harness: HarnessId) => Promise<RemoteSystemInfo>; onChange: (patch: Partial<SessionAgentLaunchConfig>) => void }) {
  const styles = usePromptStyles()
  const loader = useRef(loadSystemInfo)
  loader.current = loadSystemInfo
  const [catalog, setCatalog] = useState<RemoteSystemInfo | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setCatalog(null); setError('')
    if (!suppliedProfile && loader.current) Promise.resolve().then(() => loader.current!(harness)).then((info) => {
      if (info.error) throw new Error(info.error)
      if (active) setCatalog(info)
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load agent options') })
    return () => { active = false }
  }, [harness, suppliedProfile])
  const profile = suppliedProfile ?? (catalog ? { id: harness, name: harness, harnessId: harness, defaultConfig: {}, models: catalog.models ?? [], efforts: catalog.efforts?.map((option) => option.value) ?? [], apiProviders: [] } : undefined)
  const options = HARNESS_LAUNCH_OPTIONS[harness]
  const model = profile?.models.find((item) => item.id === config.model)
  const fast = Boolean(findCodexFastServiceTier(model))
  const select = (label: string, value: string, choices: string[], change: (value: string) => void) => <SelectField label={label} value={value} options={choices.map((id) => ({ id, label: id }))} onChange={change} />
  return <View style={styles.stack}>
    {error ? <Text style={styles.warningText}>{error}</Text> : null}
    {profile?.apiProviders.length ? <SelectField label="AI provider" value={config.apiProviderId ?? ''} options={[{ id: '', label: 'Default provider' }, ...profile.apiProviders.map((provider) => ({ id: provider.id, label: [provider.name, provider.keyName].filter(Boolean).join(' · ') }))]} onChange={(apiProviderId) => onChange({ apiProviderId: apiProviderId || null, effort: undefined })} /> : null}
    {profile?.models.length ? <SelectField label="Model" value={config.model ?? ''} options={profile.models.map((item) => ({ id: item.id, label: item.name }))} onChange={(value) => onChange({ model: value, fastMode: false })} /> : <EditableField field={{ label: 'Model', type: 'string' }} value={config.model} onChange={(value) => onChange({ model: String(value) || undefined })} />}
    {!config.apiProviderId && profile?.efforts.length ? select('Effort', config.effort ?? '', profile.efforts, (effort) => onChange({ effort })) : !profile && !config.apiProviderId ? <EditableField field={{ label: 'Effort', type: 'string' }} value={config.effort} onChange={(value) => onChange({ effort: String(value) || undefined })} /> : null}
    {fast ? <EditableField field={{ label: 'Fast mode', type: 'boolean' }} value={config.fastMode} onChange={(value) => onChange({ fastMode: value === true })} /> : null}
    <SelectField label="Permission mode" value={config.permissionMode ?? options.permissionModes[0]} options={options.permissionModes.map((id) => ({ id, label: permissionModeLabel(id) }))} onChange={(permissionMode) => onChange({ permissionMode: permissionMode as SessionAgentLaunchConfig['permissionMode'] })} />
    {options.sandboxModes.length ? select('Sandbox', config.sandboxMode ?? 'off', options.sandboxModes, (sandboxMode) => onChange({ sandboxMode: sandboxMode as SessionAgentLaunchConfig['sandboxMode'] })) : <Text style={styles.meta}>Execution isolation follows the agent’s permission settings.</Text>}
  </View>
}
