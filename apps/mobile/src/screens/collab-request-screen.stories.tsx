import type { ComponentProps } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { SessionAgentRequestPayload } from '@superone/shared/agent-types'
import { permissionExamples } from '../preview/permissions'
import { MobileThemeProvider } from '../theme/context'
import { CollabRequestScreen } from './collab-request-screen'

const noop = () => {}
const base: SessionAgentRequestPayload = permissionExamples.session_agents_confirm.sessionAgentsConfirm
const [spawn, handoff, link] = base.launches

const LONG_SUMMARY = 'Review the mobile permission flow end to end and report a verdict: '
  + 'check that every prompt survives orientation changes on Android, that the composer keeps its draft, '
  + 'and that approving from the lock screen still resumes the right session.'

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 720 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }

/** The chip menus portal into the theme provider's menu host, so insets sit above it. */
function Preview({ width = 390, height = 720, colorScheme, locale, ...props }: ComponentProps<typeof CollabRequestScreen> & { width?: number; height?: number; colorScheme?: 'light' | 'dark'; locale?: 'en' | 'zh' }) {
  return <SafeAreaProvider initialMetrics={METRICS}><MobileThemeProvider colorScheme={colorScheme} locale={locale}>
    <View style={{ width, height }}><CollabRequestScreen {...props} /></View>
  </MobileThemeProvider></SafeAreaProvider>
}

export default {
  title: 'Mobile/CollabRequest', component: CollabRequestScreen, render: Preview,
  args: { payload: base, onApprove: noop, onReject: noop },
}

/** Spawn + handoff + link, the first card open — the shipping fixture. */
export const ThreeLaunches = {}

export const SingleSpawn = { args: { payload: { ...base, launches: [spawn] } } }

export const HandoffOnly = { args: { payload: { ...base, launches: [handoff] } } }

export const LinkOnly = { args: { payload: { ...base, launches: [link] } } }

/** Two Codex launches get the desktop's `codex 1` / `codex 2` labels. */
export const DuplicateHarness = { args: { payload: { ...base, launches: [
  spawn,
  { ...spawn, launchId: 'preview-spawn-2', name: 'Tester', role: 'Regression', summary: 'Run the mobile suite and report failures.' },
] } } }

/** The summary is all the user approves; the agent passes the full brief at start. */
export const LongSummary = { args: { payload: { ...base, launches: [{ ...spawn, summary: LONG_SUMMARY }] } } }

export const Worktree = { args: { payload: { ...base, launches: [{ ...spawn, config: {
  ...spawn.config, worktree: { enabled: true, mode: 'detach', baseBranch: 'main' },
} }] } } }

export const Narrow = { args: { width: 320 } }

export const Light = { args: { colorScheme: 'light' } }

export const Chinese = { args: { locale: 'zh' } }
