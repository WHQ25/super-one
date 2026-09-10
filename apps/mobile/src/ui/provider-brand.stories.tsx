import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import { ProviderBrand } from './provider-brand'

function Preview(props: { brandKey: string; name: string }) {
  return <MobileThemeProvider>
    <View style={{ padding: 24, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <ProviderBrand brandKey={props.brandKey} name={props.name} size={14} />
    </View>
  </MobileThemeProvider>
}

export default {
  title: 'Mobile/ProviderBrand',
  component: ProviderBrand,
  render: Preview,
  args: { brandKey: 'openai', name: 'Codex (Official)' },
}

export const OpenAI = {}
export const Claude = { args: { brandKey: 'claude', name: 'Claude Code (Official)' } }
export const OpenRouter = { args: { brandKey: 'openrouter', name: 'OpenRouter' } }
