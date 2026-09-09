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
