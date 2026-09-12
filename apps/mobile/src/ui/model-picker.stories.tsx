import { useState } from 'react'
import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import { ModelPicker, type ModelPickerProps } from './model-picker'

function Preview(props: ModelPickerProps) {
  const [model, setModel] = useState(props.model)
  return <MobileThemeProvider>
    <View style={{ width: 280, padding: 12 }}>
      <ModelPicker {...props} model={model} onModel={setModel} />
    </View>
  </MobileThemeProvider>
}

export default {
  title: 'Mobile/ModelPicker',
  component: ModelPicker,
  render: Preview,
  args: {
    harness: 'codex', compact: true, model: 'gpt-5.6-sol',
    models: [
      { id: 'gpt-5.6-sol', name: 'gpt-5.6-sol', description: 'Raw catalog name' },
      { id: 'gpt-6-astra', name: '', description: 'Model ID fallback' },
      { id: 'custom', name: 'Custom model with a long display name', description: 'Custom name preserved' },
    ],
    efforts: [], effort: '', onModel: () => {}, onEffort: () => {},
  } satisfies ModelPickerProps,
}

export const Codex = {}
export const MissingCatalogEntry = { args: { model: 'gpt-6-astra', models: [] } }
export const Empty = { args: { model: '', models: [] } }
export const Disabled = { args: { disabled: true } }
export const LongName = { args: { model: 'custom' } }

const CLAUDE_CATALOG = [
  { id: 'opus[1m]', name: 'Opus 5 1M', description: 'Opus 5 with 1M context' },
  { id: 'opus', name: 'Opus 5', description: 'Best for everyday, complex tasks' },
  { id: 'sonnet', name: 'Sonnet 5', description: 'Balanced' },
  { id: 'haiku', name: 'Haiku 4.5', description: 'Fastest' },
]
const CLAUDE_PROVIDERS = [
  { id: null, name: 'Claude', brand: 'claude' },
  { id: 'cred-kimi', name: 'Kimi', brand: 'kimi', keyName: 'cai', modelEnv: { opus: { id: 'kimi-k2', name: 'Kimi K2' }, sonnet: { id: 'kimi-k2', name: 'Kimi K2' } } },
  { id: 'cred-plain', name: 'Relay', brand: 'anthropic', keyName: 'no mapping' },
]
const CLAUDE_EFFORTS = [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]

/** The host default: the catalog as-is, effort selectable. */
export const ClaudeDefault = {
  args: {
    harness: 'claude', model: 'opus[1m]', models: CLAUDE_CATALOG, efforts: CLAUDE_EFFORTS, effort: 'high',
    providers: CLAUDE_PROVIDERS, providerId: null, onProvider: () => {},
  } satisfies Partial<ModelPickerProps>,
}

/**
 * A session on a mapped credential: `opus` / `opus[1m]` fold onto one "Kimi K2"
 * row, the trigger names it, and effort is hidden — even though the host's
 * global binding (`activeProvider`) is unmapped.
 */
export const ClaudeMappedProvider = {
  args: {
    ...ClaudeDefault.args,
    providerId: 'cred-kimi',
    efforts: [],
    activeProvider: { id: 'cred-plain', name: 'Relay', presetKey: 'anthropic', modelEnv: {}, forcedEffort: null },
  } satisfies Partial<ModelPickerProps>,
}

/** A credential with no mapping keeps the Claude catalog and effort. */
export const ClaudePlainProvider = {
  args: { ...ClaudeDefault.args, providerId: 'cred-plain' } satisfies Partial<ModelPickerProps>,
}
