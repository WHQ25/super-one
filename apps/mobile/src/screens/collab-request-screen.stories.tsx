import type { ComponentProps } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { SessionAgentRequestPayload } from '@superone/shared/agent-types'
import { permissionExamples } from '../preview/permissions'
import { MobileThemeProvider } from '../theme/context'
import { CollabRequestScreen } from './collab-request-screen'
import { CollabTaskScreen } from './collab-task-screen'

const noop = () => {}
const base: SessionAgentRequestPayload = permissionExamples.session_agents_confirm.sessionAgentsConfirm
const [spawn, handoff, link] = base.launches

const LONG_TASK = [
  '## Review request',
  '',
  'Please review the mobile permission flow and report back with a **verdict**.',
  '',
  ...Array.from({ length: 12 }, (_, i) => `${i + 1}. Verify step ${i + 1} still handles orientation changes on Android.`),
  '',
  '```ts',
  "requestNative('previewFile', { path })",
  '```',
].join('\n')

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 720 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }

/** The chip menus portal into the theme provider's menu host, so insets sit above it. */
function Preview({ width = 390, height = 720, colorScheme, locale, ...props }: ComponentProps<typeof CollabRequestScreen> & { width?: number; height?: number; colorScheme?: 'light' | 'dark'; locale?: 'en' | 'zh' }) {
  return <SafeAreaProvider initialMetrics={METRICS}><MobileThemeProvider colorScheme={colorScheme} locale={locale}>
    <View style={{ width, height }}><CollabRequestScreen {...props} /></View>
  </MobileThemeProvider></SafeAreaProvider>
}

export default {
  title: 'Mobile/CollabRequest', component: CollabRequestScreen, render: Preview,
  args: { payload: base, onApprove: noop, onReject: noop, onOpenTask: noop },
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

/** Over the wire the brief is withheld (`taskDeferred`); the row still offers it. */
export const DeferredTask = { args: { payload: { ...base, launches: base.launches.map((launch) => ({ ...launch, task: '', taskDeferred: true })) } } }

export const Worktree = { args: { payload: { ...base, launches: [{ ...spawn, config: {
  ...spawn.config, worktree: { enabled: true, mode: 'detach', baseBranch: 'main' },
} }] } } }

export const Narrow = { args: { width: 320 } }

export const Light = { args: { colorScheme: 'light' } }

export const Chinese = { args: { locale: 'zh' } }

/** The brief's own page, driven by a loader: resolved, slow, failed, and empty. */
function TaskPreview({ load }: ComponentProps<typeof CollabTaskScreen>) {
  return <MobileThemeProvider><View style={{ width: 390, height: 720 }}><CollabTaskScreen load={load} /></View></MobileThemeProvider>
}

export const TaskLoaded = { render: () => <TaskPreview load={() => Promise.resolve(LONG_TASK)} /> }
export const TaskLoading = { render: () => <TaskPreview load={() => new Promise<string>(() => {})} /> }
export const TaskFailed = { render: () => <TaskPreview load={() => Promise.reject(new Error('That collaboration request is no longer pending'))} /> }
export const TaskEmpty = { render: () => <TaskPreview load={() => Promise.resolve('')} /> }
