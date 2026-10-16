import { useMemo, useState } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import { Text } from '../ui/text'
import { SuggestedTaskLaunchSheet } from './suggested-task-launch-sheet'
import { suggestedTaskOptions } from './suggested-task-launch-fixtures'
import type { SuggestedTaskLaunchRequest } from '../suggested-task-actions'

type Props = { colorScheme?: 'light' | 'dark'; locale?: 'en' | 'zh'; state?: 'ready' | 'loading' | 'error' | 'empty' | 'launch-error' | 'launching'; long?: boolean }
const metrics = { frame: { x: 0, y: 0, width: 375, height: 812 }, insets: { top: 44, bottom: 34, left: 0, right: 0 } }

function Preview({ colorScheme = 'light', locale = 'en', state = 'ready', long = false }: Props) {
  const [dismissed, setDismissed] = useState(false)
  const request = useMemo<SuggestedTaskLaunchRequest>(() => ({
    loadOptions: async () => {
      if (state === 'loading') return new Promise(() => {})
      if (state === 'error') throw new Error('Could not load agent options')
      if (state === 'empty') return { ...suggestedTaskOptions, profiles: [] }
      return long ? { ...suggestedTaskOptions, profiles: suggestedTaskOptions.profiles.map(profile => ({ ...profile, name: `${profile.name} — Project implementation and review agent` })) } : suggestedTaskOptions
    },
    launch: async () => {
      if (state === 'launching') return new Promise(() => {})
      if (state === 'launch-error') throw new Error('Could not launch task')
      return { sessionId: 'child' }
    },
  }), [state, long])
  return <SafeAreaProvider initialMetrics={metrics}><MobileThemeProvider colorScheme={colorScheme} locale={locale}>
    <View style={{ width: 375, height: 812 }}>
      {dismissed ? <Text>Closed</Text> : <SuggestedTaskLaunchSheet request={request} onDismiss={() => setDismissed(true)} />}
    </View>
  </MobileThemeProvider></SafeAreaProvider>
}

export default { title: 'Mobile/SuggestedTaskLaunch', component: SuggestedTaskLaunchSheet, render: Preview }
export const Ready = {}
export const Dark = { args: { colorScheme: 'dark' } }
export const Chinese = { args: { colorScheme: 'dark', locale: 'zh' } }
export const Loading = { args: { state: 'loading' } }
export const ErrorWithRetry = { args: { state: 'error' } }
export const Empty = { args: { state: 'empty' } }
export const LaunchFailure = { args: { state: 'launch-error' } }
export const Launching = { args: { state: 'launching' } }
export const LongAgentName = { args: { long: true } }
