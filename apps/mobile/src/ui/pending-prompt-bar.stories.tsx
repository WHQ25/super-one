import { useState, type ReactNode } from 'react'
import { View } from 'react-native'
import type { PermissionRequest } from '@superone/shared/agent-types'
import type { PendingPrompt } from '../pending-prompt-state'
import { MobileThemeProvider } from '../theme/context'
import { PermissionSheet } from '../prompts/PermissionSheet'
import { Text } from './text'
import { PendingPromptBar } from './pending-prompt-bar'
import { TodoPanel } from './todo-panel'

const bashRequest: PermissionRequest = { requestId: 'bash', toolName: 'Bash', input: { command: 'bun run test --changed HEAD', description: 'Run the affected tests' }, allowAlwaysAllow: true }
const bash: PendingPrompt = { kind: 'permission', request: bashRequest }
const edit: PendingPrompt = { kind: 'permission', request: { requestId: 'edit', toolName: 'Edit', input: { file_path: '/Users/dev/super-one/apps/mobile/src/navigation/mobile-app.tsx', old_string: 'a', new_string: 'b' }, allowAlwaysAllow: false } }
const app: PendingPrompt = { kind: 'permission', request: { requestId: 'cu', toolName: 'computer_use', requestKind: 'computer_use_grant', input: {}, allowAlwaysAllow: true, computerUseGrant: { app: 'Finder', bundleId: 'com.apple.finder', toolName: 'computer_use' } } }
const question: PendingPrompt = { kind: 'question', request: { requestId: 'q', questions: [{ header: 'Library', question: 'Which date library should the composer use for relative timestamps?', options: [{ label: 'date-fns', description: '' }, { label: 'dayjs', description: '' }], multiSelect: false }] } }
const questions: PendingPrompt = { kind: 'question', request: { requestId: 'qs', questions: [{ header: '接入', question: '这个功能要不要同时接入桌面端？', options: [{ label: '要', description: '' }], multiSelect: false }, { header: 'Tests', question: 'Add jest coverage?', options: [{ label: 'Yes', description: '' }], multiSelect: false }] } }
const plan: PendingPrompt = { kind: 'plan', request: { requestId: 'plan', planContent: '# Plan', planFilePath: '/Users/dev/super-one/.claude/plans/collapsible-prompts.md', allowedPrompts: [] } }

function Case({ label, children }: { label: string; children: ReactNode }) {
  return <View style={{ gap: 4 }}>
    <Text style={{ fontSize: 12, opacity: 0.6, paddingHorizontal: 12 }}>{label}</Text>
    {children}
  </View>
}

function Phone() {
  return <MobileThemeProvider>
    <View style={{ width: 390, paddingVertical: 12, gap: 20 }}>
      <Case label="Bash · tool name and command"><PendingPromptBar prompt={bash} onExpand={() => {}} /></Case>
      <Case label="Edit · file name, not the path"><PendingPromptBar prompt={edit} onExpand={() => {}} /></Case>
      <Case label="Structured kind · presentation title + description"><PendingPromptBar prompt={app} onExpand={() => {}} /></Case>
      <Case label="Question · first question, truncated"><PendingPromptBar prompt={question} onExpand={() => {}} /></Case>
      <Case label="Questions · CJK"><PendingPromptBar prompt={questions} onExpand={() => {}} /></Case>
      <Case label="Plan · file name"><PendingPromptBar prompt={plan} onExpand={() => {}} /></Case>
      <Case label="Over the todo strip, as in the chat column · the card is filled, the strip is not">
        <PendingPromptBar prompt={bash} onExpand={() => {}} />
        <TodoPanel tablet={false} todos={{ '1': { id: '1', subject: 'Run the suite', description: '', status: 'in_progress' } }} />
      </Case>
    </View>
  </MobileThemeProvider>
}

function Tablet() {
  return <MobileThemeProvider>
    <View style={{ width: 820, paddingVertical: 12, gap: 20 }}>
      <Case label="Tablet · same card, wider"><PendingPromptBar prompt={bash} onExpand={() => {}} /></Case>
      <Case label="Tablet · long question"><PendingPromptBar prompt={question} onExpand={() => {}} /></Case>
    </View>
  </MobileThemeProvider>
}

/** Tap outside the sheet to put it away; tap the strip to bring it back; X denies. */
function RoundTrip() {
  const [collapsed, setCollapsed] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  return <MobileThemeProvider>
    <View style={{ width: 390, height: 640, justifyContent: 'flex-end' }}>
      <Text style={{ padding: 12 }}>{outcome ?? (collapsed ? 'Put away — tap the strip' : 'Sheet open — tap outside it')}</Text>
      {collapsed && !outcome ? <PendingPromptBar prompt={bash} onExpand={() => setCollapsed(false)} /> : null}
      {!outcome ? <PermissionSheet perm={bashRequest} collapsed={collapsed} onCollapse={() => setCollapsed(true)}
        onAllow={() => setOutcome('Allowed')} onDeny={() => setOutcome('Denied')} /> : null}
    </View>
  </MobileThemeProvider>
}

export default {
  title: 'Mobile/PendingPromptBar',
  component: PendingPromptBar,
  render: Phone,
}

export const PhoneStrip = { render: Phone }
export const TabletCard = { render: Tablet }
export const CollapseAndReopen = { render: RoundTrip }
