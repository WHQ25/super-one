import { useState } from 'react'
import { useComposerDraft } from '../navigation/use-composer-draft'
import { useComposerSend } from '../navigation/use-composer-send'
import { Text } from '../ui/text'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { MobileThemeProvider } from '../theme/context'
import { ChatComposer, type ChatComposerProps } from './chat-composer'

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

function Preview(props: ChatComposerProps) {
  return <MobileThemeProvider>
    <SafeAreaProvider initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, left: 0, right: 0, bottom: 34 },
    }}>
      <View style={{ width: 390, justifyContent: 'flex-end', minHeight: 160 }}>
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

export const PhoneFocusedActionBar = {
  args: { tablet: false, focused: true, draft: 'Ask about the diff' },
  name: 'Phone · focused action bar',
}

export const PhoneFocusedStop = {
  args: { tablet: false, focused: true, streaming: true, draft: 'queue this' },
  name: 'Phone · focused send and stop',
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
 * Every follow-up is a chip here, including the first — desktop puts that one in
 * the input as ghost text, but there is no Tab key on a phone to accept it with.
 */
export const PromptSuggestions = {
  args: { promptSuggestions: SUGGESTIONS },
  name: 'Prompt suggestions',
}

export const PromptSuggestionsLongText = {
  args: {
    promptSuggestions: [
      '帮我把 lifecycle 规则的检查、方案 D 的取舍、以及回归测试的范围整理成一段可以直接贴进 PR 描述的说明',
      '短的那条',
    ],
  },
  name: 'Prompt suggestions · long text truncates',
}

export const PromptSuggestionsWithDraft = {
  args: { promptSuggestions: SUGGESTIONS, draft: '跑一遍受影响的测试' },
  name: 'Prompt suggestions · after a tap fills the draft',
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
