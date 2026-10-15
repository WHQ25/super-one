import { useState } from 'react'
import { useComposerDraft } from '../navigation/use-composer-draft'
import { useComposerSend } from '../navigation/use-composer-send'
import { Text } from '../ui/text'
import { Pressable, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { MobileThemeProvider } from '../theme/context'
import type { ScheduledSend, SessionGoal } from '@superone/shared/agent-types'
import type { ScheduledSendControls } from '../navigation/use-scheduled-send'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { ChatComposer, type ChatComposerProps } from './chat-composer'
import { useSessionIndicators } from '../navigation/use-session-indicators'
import { MobileVoiceEntry } from '../voice/mobile-voice-controls'

const noop = () => {}

const base: ChatComposerProps = {
  provider: 'codex',
  draft: '',
  streaming: false,
  attachments: [],
  permissionModes: ['default', 'acceptEdits'],
  permissionMode: 'default',
  projectDirs: [],
  sessionDirs: [],
  onManageDirectories: noop,
  sandboxInfo: { enabled: true, autoAllowBash: false },
  contextTokens: 82_400,
  contextWindow: 200_000,
  totalCostUsd: 0.42,
  slashHits: [],
  slashCatalogStatus: 'ready',
  mentionRows: [],
  onDraft: noop,
  onSend: noop,
  onStop: noop,
  onSubmitFromKeyboard: noop,
  onAttachmentMenu: noop,
  onAttachImage: noop,
  onAttachPdf: noop,
  onInsertSnippet: noop,
  onRemoveAttachment: noop,
  onPermissionMode: noop,
  onSandboxMode: noop,
  onSlash: noop,
  onSlashDismiss: noop,
  onMention: noop,
  selection: {
    model: 'gpt-5.6',
    models: [{ id: 'gpt-5.6', name: 'gpt-5.6', description: '' }],
    effort: 'medium',
    efforts: [{ value: 'medium', label: 'Medium' }],
    onModel: noop,
    onEffort: noop,
  },
}

function Preview({ frameWidth = 390, colorScheme, locale, ...props }: ChatComposerProps & {
  frameWidth?: number; colorScheme?: 'light' | 'dark'; locale?: 'en' | 'zh'
}) {
  return <MobileThemeProvider colorScheme={colorScheme} locale={locale}>
    <SafeAreaProvider initialMetrics={{
      frame: { x: 0, y: 0, width: frameWidth, height: 844 },
      insets: { top: 47, left: 0, right: 0, bottom: 34 },
    }}>
      <View style={{ width: frameWidth, justifyContent: 'flex-end', minHeight: 160 }}>
        <ChatComposer {...props} />
      </View>
    </SafeAreaProvider>
  </MobileThemeProvider>
}

export default {
  title: 'Mobile/ChatComposer',
  component: ChatComposer,
  render: Preview,
  args: { ...base, tablet: false },
}

export const Default = {
  name: 'Phone · compact empty hides send',
}

function SessionTransitionPreview() {
  const indicators = useSessionIndicators()
  return <MobileThemeProvider>
    <View style={{ width: 390, gap: 16 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Open session with goal" onPress={() => indicators.sync({
        sandboxInfo: null,
        worktree: { isWorktree: false, worktreePath: null, gitBranch: 'main' },
        contextTokens: 10_000, contextWindow: 200_000, totalCostUsd: 0.42,
        session: { sessionGoal: { objective: 'Finish the mobile fixes', status: 'active' },
          sessionAgents: null, _worktreeRemoved: false, rateLimitInfo: null, messages: [] },
      })}><Text>Open session with goal</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Create new session" onPress={indicators.reset}>
        <Text>Create new session</Text>
      </Pressable>
      <Preview {...base} tablet={false} provider="claude" sandboxInfo={indicators.sandboxInfo}
        contextTokens={indicators.usage.contextTokens} totalCostUsd={indicators.usage.totalCostUsd}
        goal={indicators.sessionGoal} goalCapability={HARNESS_CAPABILITIES.claude.goal} />
    </View>
  </MobileThemeProvider>
}

export const NewSessionAfterGoal = {
  name: 'Phone · new session clears the previous goal',
  render: SessionTransitionPreview,
}

function OpenCodeAgentsPreview() {
  const [agent, setAgent] = useState('plan')
  return <Preview {...base} provider="opencode" permissionModes={[]} tablet={false} selection={{
    ...base.selection!, agent, onAgent: setAgent,
    agents: [
      { id: 'build', name: 'Build', description: 'Implement changes using your configured permissions.' },
      { id: 'plan', name: 'Plan', description: 'Explore the project and prepare a plan.' },
      { id: 'reviewer', name: 'Reviewer', description: 'A custom primary agent from OpenCode.' },
    ],
    onRefresh: async () => { await new Promise((resolve) => setTimeout(resolve, 700)) },
  }} />
}
export const OpenCodeNativeAgents = { render: () => <OpenCodeAgentsPreview /> }

/** A landscape phone is wide enough for the sidebar but keeps this compact field. */
/**
 * The status row is two anchored groups: what the turn will do on the left,
 * what the session is on the right. These three cover the ways that can go
 * wrong — a name long enough to need the left group's scroller, the folder chip
 * arriving on the outer edge, and no model picker at all.
 */
export const StatusRowGroups = {
  args: { projectDirs: ['/workspace/design-system'], sessionDirs: ['/workspace/notes', '/workspace/api'] },
}

export const StatusRowLongModelName = {
  args: {
    projectDirs: ['/workspace/design-system'],
    selection: {
      ...base.selection!,
      model: 'anthropic/claude-fable-5-1-with-an-absurdly-long-catalog-name',
      models: [{ id: 'anthropic/claude-fable-5-1-with-an-absurdly-long-catalog-name', name: 'anthropic/claude-fable-5-1-with-an-absurdly-long-catalog-name', description: '' }],
    },
  },
}

export const StatusRowWithoutModelPicker = {
  args: { selection: undefined, projectDirs: ['/workspace/design-system'] },
}

/**
 * The goal chip on the outer edge, where the come-and-go readouts live. It and
 * the folder chip cannot collide in production — folders answer for a session
 * being configured, a goal only exists once one is running — so the folder
 * lists stay empty here.
 */
export const StatusRowWithActiveGoal = {
  args: {
    goalCapability: HARNESS_CAPABILITIES.codex.goal,
    goal: { objective: 'Ship the login flow end to end', status: 'active' } satisfies SessionGoal,
  },
}

export const StatusRowWithAchievedGoal = {
  args: {
    goalCapability: HARNESS_CAPABILITIES.codex.goal,
    goal: { objective: 'Ship the login flow end to end', status: 'complete' } satisfies SessionGoal,
  },
}

/** The ring doubles as the subscription meter: outer arc account, inner arc context. */
export const StatusRowWithUsage = {
  args: {
    projectDirs: ['/workspace/design-system'],
    usage: {
      usage: {
        kind: 'codex', title: 'Codex', account: 'dev@example.com', planType: 'plus', extraUsage: null, fetchedAt: Date.now(),
        windows: [{ label: '5h', usedPercent: 82, resetsAt: Math.round(Date.now() / 1000) + 2400 }, { label: '7d', usedPercent: 55, resetsAt: null }],
        resetCredits: 1,
      },
      onOpen: noop, onRefresh: noop, onConsumeResetCredit: async () => 'reset',
    },
  },
}

export const StatusRowRateLimited = {
  args: {
    usage: { usage: null, rateLimit: { status: 'rejected', resetsAt: Math.round(Date.now() / 1000) + 3600 } },
  },
}

export const TabletStatusRowGroups = {
  args: {
    tablet: true,
    projectDirs: ['/workspace/design-system'],
    sessionDirs: ['/workspace/notes'],
    draft: 'Groups anchor to the card edges too',
  },
}

export const LandscapePhone = {
  args: { tablet: false },
  name: 'Landscape phone · compact empty hides send',
}

export const PhoneCompactWithDraft = {
  args: { tablet: false, draft: 'Keep the input short' },
  name: 'Phone · compact send on the input row',
}

function VoiceDeliveryPreview({ expanded = false, empty = false, light = false, loading = false, switchHarness = false }: {
  expanded?: boolean; empty?: boolean; light?: boolean; loading?: boolean; switchHarness?: boolean
}) {
  const [provider, setProvider] = useState<'claude' | 'codex'>(switchHarness ? 'claude' : 'codex')
  const [focused, setFocused] = useState(expanded)
  const [draft, setDraft] = useState(empty ? '' : '检查 Composer 按钮的位置和顺序\n切换键盘布局时保留这条草稿。')
  const [feedback, setFeedback] = useState('Offline preview: voice and send only update this fixture.')
  return <MobileThemeProvider colorScheme={light ? 'light' : 'dark'} locale="zh"><View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Toggle keyboard layout" onPress={() => setFocused(!focused)}>
      <Text>Toggle keyboard layout</Text>
    </Pressable>
    {switchHarness ? <Pressable accessibilityRole="button" accessibilityLabel="Switch harness"
      onPress={() => setProvider(provider === 'claude' ? 'codex' : 'claude')}>
      <Text>Harness: {provider} · switch</Text>
    </Pressable> : null}
    <Text>{feedback}</Text>
    <Preview {...base} provider={provider} tablet={false} focused={focused} draft={draft} onDraft={setDraft}
      frameWidth={320} colorScheme={light ? 'light' : 'dark'} locale="zh" loadingConversation={loading}
      onSend={() => { setFeedback(`Sent: ${draft}`); setDraft('') }}
      voiceEntry={provider === 'codex' ? <MobileVoiceEntry enabled busy={loading} onStart={() => setFeedback('Voice requested (offline preview).')} /> : undefined} />
  </View></MobileThemeProvider>
}

export const PhoneVoiceDelivery = { name: 'Phone · voice then send move together with keyboard', render: () => <VoiceDeliveryPreview /> }
export const PhoneVoiceExpandedLight = { name: 'Phone · expanded voice and send, narrow light Chinese', render: () => <VoiceDeliveryPreview expanded light /> }
export const PhoneVoiceEmpty = { name: 'Phone · empty voice entry in either keyboard state', render: () => <VoiceDeliveryPreview empty /> }
export const PhoneVoiceRestoring = { name: 'Phone · disabled delivery modes during restore', render: () => <VoiceDeliveryPreview loading /> }
export const PhoneHarnessSwitch = { name: 'Phone · empty composer stays level when switching harness', render: () => <VoiceDeliveryPreview switchHarness empty /> }
export const PhoneHarnessSwitchLight = { name: 'Phone · harness switch, narrow light Chinese', render: () => <VoiceDeliveryPreview switchHarness empty light /> }

export const PhoneFocusedActionBar = {
  args: { tablet: false, focused: true, draft: 'Ask about the diff' },
  name: 'Phone · focused action bar',
}

export const PhoneFocusedStop = {
  args: { tablet: false, focused: true, streaming: true, draft: 'queue this' },
  name: 'Phone · focused send and stop',
}

function StreamingScheduledSendPreview({ focused = true, tablet = false, light = false }: {
  focused?: boolean; tablet?: boolean; light?: boolean
}) {
  const [draft, setDraft] = useState('Queue this message')
  const [streaming, setStreaming] = useState(true)
  const [scheduled, setScheduled] = useState<ScheduledSend | null>(null)
  const [feedback, setFeedback] = useState('Tap Send to queue; long press to schedule.')
  const controls: ScheduledSendControls = {
    scheduled, available: true, loading: false, busy: false, error: '',
    schedule: async sendAt => setScheduled({ sessionId: 'preview', sendAt, armed: true, source: 'manual', message: draft }),
    cancel: async () => setScheduled(null), dismiss: async () => setScheduled(null), accept: async () => {},
  }
  return <SafeAreaProvider initialMetrics={{
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
  }}><MobileThemeProvider colorScheme={light ? 'light' : 'dark'} locale={light ? 'zh' : 'en'}>
    <View style={{ width: tablet ? 640 : light ? 320 : 390, gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Toggle streaming" onPress={() => setStreaming(!streaming)}>
        <Text>{streaming ? 'Streaming' : 'Idle'} · toggle</Text>
      </Pressable>
      <Text>{feedback}</Text>
      <ChatComposer {...base} tablet={tablet} focused={focused} hasConversation streaming={streaming}
        draft={draft} onDraft={setDraft} scheduledSend={controls}
        onSend={() => { setFeedback(`Queued: ${draft}`); setDraft('') }} onStop={() => setStreaming(false)} />
    </View>
  </MobileThemeProvider></SafeAreaProvider>
}

export const PhoneStreamingScheduledSend = {
  name: 'Phone · streaming send and long-press scheduling', render: () => <StreamingScheduledSendPreview />,
}
export const PhoneCollapsedStreamingScheduledSend = {
  name: 'Phone · collapsed streaming send and scheduling', render: () => <StreamingScheduledSendPreview focused={false} />,
}
export const PhoneStreamingScheduledSendLight = {
  name: 'Phone · narrow light Chinese streaming scheduling', render: () => <StreamingScheduledSendPreview light />,
}
export const TabletStreamingScheduledSend = {
  name: 'Tablet · streaming send and scheduling', render: () => <StreamingScheduledSendPreview tablet />,
}

export const PhoneFocusedStreamingEmpty = {
  args: {
    tablet: false, focused: true, streaming: true,
    canSteer: true, canSteerSoon: true,
  },
  name: 'Phone · streaming empty hides send and steer',
}

export const PhoneFocusedClaudeSteer = {
  args: {
    tablet: false, focused: true, streaming: true, draft: 'steer this',
    canSteer: true, canSteerSoon: true,
  },
  name: 'Phone · focused Claude steer',
}

export const PhoneFocusedCodexSteer = {
  args: {
    tablet: false, focused: true, streaming: true, draft: 'steer this',
    canSteer: true, canSteerSoon: false,
  },
  name: 'Phone · focused Codex steer only',
}

export const PhoneFocusedGrokSteer = {
  args: {
    provider: 'acp',
    tablet: false, focused: true, streaming: true, draft: 'steer this',
    canSteer: true, canSteerSoon: false,
  },
  name: 'Phone · focused Grok steer only',
}

export const Tablet = {
  args: { tablet: true, draft: 'Boxed input with chips inside the card' },
  name: 'Tablet · boxed input',
}

export const TabletEmpty = {
  args: { tablet: true },
  name: 'Tablet · empty hides send',
}

export const LoadingConversation = {
  args: { loadingConversation: true, draft: 'Send once the conversation is ready' },
  name: 'Session switch · status chips hidden',
}

const SUGGESTIONS = [
  '加上，在 Projects 分组头显示待处理计数',
  '先解释一下这个 diff',
  '跑一遍受影响的测试',
]

/**
 * Every follow-up is a row here, including the first — desktop puts that one in
 * the input as ghost text, but there is no Tab key on a phone to accept it with.
 * The panel is the slash / mention card, so it reads as one of them rather than
 * a stray chip between the status row and the action bar.
 */
export const PromptSuggestions = {
  args: { promptSuggestions: SUGGESTIONS, onPromptSuggestionsDismiss: noop },
  name: 'Prompt suggestions',
}

export const PromptSuggestionsLongText = {
  args: {
    promptSuggestions: [
      '帮我把 lifecycle 规则的检查、方案 D 的取舍、以及回归测试的范围整理成一段可以直接贴进 PR 描述的说明',
      '短的那条',
    ],
  },
  name: 'Prompt suggestions · long text wraps to two lines',
}

/** A tap fills the draft, and the panel that offered it leaves with the draft non-empty. */
export const PromptSuggestionsWithDraft = {
  args: { promptSuggestions: SUGGESTIONS, draft: '跑一遍受影响的测试' },
  name: 'Prompt suggestions · hidden once the draft has content',
}

/** A `/` query is an answer in progress; the follow-ups give up the slot to it. */
export const PromptSuggestionsYieldToSlash = {
  args: {
    promptSuggestions: SUGGESTIONS,
    draft: '/rev',
    slashHits: [
      { name: 'review', description: 'Review the current diff', argumentHint: '', isSkill: false, matchIndices: [0, 1, 2], score: 1, matched: true },
    ],
  },
  name: 'Prompt suggestions · yield to the slash list',
}

/** Nothing to offer mid-turn: the harness sends follow-ups only once it stops. */
export const PromptSuggestionsWhileStreaming = {
  args: { promptSuggestions: SUGGESTIONS, streaming: true },
  name: 'Prompt suggestions · hidden while streaming',
}

/** Run in the native preview to exercise Chinese IME composition and rapid taps. */
function SendingPreview() {
  const draft = useComposerDraft()
  const [feedback, setFeedback] = useState('Type Chinese text, then tap Send without dismissing the keyboard.')
  const send = useComposerSend(draft.editorRef, 'story', () => {
    const captured = draft.capture()
    setFeedback(`Sent: ${captured.title}`)
    draft.clearSent(captured.revision)
  }, setFeedback)
  return <View>
    <Text>{feedback}</Text>
    <Preview {...base} draft={draft.draft} onDraft={draft.changeText} onSend={() => void send()}
      nativeDraft={{ controller: draft.editorRef, document: draft.document.current, generation: draft.generation,
        onChange: draft.accept, onError: setFeedback }} />
  </View>
}
export const SendAfterComposition = { render: () => <MobileThemeProvider><SendingPreview /></MobileThemeProvider> }

/** A long session whose prompt cache expired offers continuing in a new one. */
const continuation = { onContinue: noop, onContinueHere: noop, onDontShowAgain: noop }
export const PhoneSessionContinuation = { name: 'Phone · continue a long session in a new one', args: { continuation } }
export const PhoneSessionContinuationLight = {
  name: 'Phone · continue a long session, narrow light Chinese',
  args: { continuation, frameWidth: 320, colorScheme: 'light', locale: 'zh' },
}
export const TabletSessionContinuation = { name: 'Tablet · continue a long session', args: { continuation, tablet: true, frameWidth: 700 } }

export const AttachedContext = { args: { contextAttachments: [{ id: 'dial', title: 'Agent dial', source: 'Bits & Bolts', content: '{"part":"dial"}' }, { id: 'background', title: 'CAD context', content: 'Background selection' }], onRemoveContext: noop } }
export const ContextRemovalError = { args: { contextAttachments: [{ id: 'dial', title: 'Agent dial', source: 'CAD' }], contextError: 'Could not remove context. The host is disconnected.', onRemoveContext: noop } }
