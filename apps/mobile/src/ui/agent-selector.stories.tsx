import { useState } from 'react'
import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import { Text } from './text'
import { AgentMenuOptions, AgentSelector } from './agent-selector'

const agents = [
  { id: 'build', name: 'Build', description: 'Implement changes using your configured permissions.' },
  { id: 'plan', name: 'Plan', description: 'Explore the project and prepare a plan.' },
  { id: 'team/reviewer', name: 'Team Reviewer', description: 'A custom primary agent from OpenCode.' },
]

function Preview({ empty = false, loading = false, error = '', long = false, dark = false, chinese = false }: {
  empty?: boolean; loading?: boolean; error?: string; long?: boolean; dark?: boolean; chinese?: boolean
}) {
  const [value, setValue] = useState<string | null>(null)
  const catalog = empty ? [] : long ? [...agents, {
    id: 'long', name: 'A Very Long Custom Agent Name for Narrow Chat Panes',
    description: 'A long project agent description wraps below its name without drifting to the icon column.',
  }] : agents
  return <MobileThemeProvider colorScheme={dark ? 'dark' : 'light'} locale={chinese ? 'zh' : 'en'}>
    <View style={{ width: long ? 240 : 300, gap: 12, padding: 4 }}>
      <AgentSelector agents={catalog} value={value} onChange={setValue} />
      <View style={{ padding: 4, borderWidth: 1, borderColor: '#88888860', borderRadius: 8 }}>
        <Text style={{ padding: 8, fontSize: 12, opacity: 0.6 }}>Agent</Text>
        <AgentMenuOptions agents={catalog} value={value} onChange={setValue} loading={loading} error={error} />
      </View>
    </View>
  </MobileThemeProvider>
}

export default { title: 'Mobile/AgentSelector', component: AgentSelector }
export const Default = { render: () => <Preview /> }
export const Dark = { render: () => <Preview dark /> }
export const Chinese = { render: () => <Preview chinese /> }
export const NarrowLongContent = { render: () => <Preview long /> }
export const Loading = { render: () => <Preview empty loading /> }
export const Empty = { render: () => <Preview empty /> }
export const Error = { render: () => <Preview empty error="Could not refresh agents" /> }
