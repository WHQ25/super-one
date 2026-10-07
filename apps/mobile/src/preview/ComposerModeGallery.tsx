import { useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { CodexReasoningEffort, HarnessId, ModelOption, RemoteEffortOption } from '@superone/shared/agent-types'
import { composerMode } from '@superone/shared/composer-mode'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { ChatComposer, type ChatComposerProps } from '../screens/chat-composer'
import { ultracodeOptionParam } from '../model-picker-state'
import { useMobileTheme } from '../theme/context'
import { Text } from '../ui/text'
import type { NativeComposerController } from '../ui/native-composer-input'
import { documentFromNativeMentions, type MentionDocument } from '../mention-document'

const noop = () => {}

const MODELS: Record<'claude' | 'codex', { models: ModelOption[]; efforts: RemoteEffortOption[] }> = {
  claude: {
    models: [{ id: 'opus', name: 'Opus 5.5', description: '', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] }],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({ value, label: value })),
  },
  codex: {
    models: [{ id: 'gpt-5.6', name: 'gpt-5.6', description: '' }],
    efforts: ['medium', 'high', 'xhigh', 'ultra'].map((value) => ({ value, label: value })),
  },
}

/** The composer's fixed props: an idle session with nothing attached. */
const BASE: Omit<ChatComposerProps, 'provider' | 'draft' | 'onDraft'> = {
  streaming: false, attachments: [], permissionModes: ['default'], permissionMode: 'default',
  projectDirs: [], sessionDirs: [], onManageDirectories: noop, sandboxInfo: null,
  contextTokens: 42_000, contextWindow: 200_000, totalCostUsd: 0.12,
  slashHits: [], slashCatalogStatus: 'ready', mentionRows: [],
  onSend: noop, onStop: noop, onSubmitFromKeyboard: noop, onAttachmentMenu: noop, onAttachImage: noop,
  onAttachPdf: noop, onInsertSnippet: noop, onRemoveAttachment: noop, onPermissionMode: noop,
  onSandboxMode: noop, onSlash: noop, onSlashDismiss: noop, onMention: noop, focused: false,
}

/**
 * One production composer whose border follows the shipping `composerMode`
 * rule: type or delete `ultrathink` / `ultracode`, flip Ultracode under the
 * model picker's Options, or pick Codex's Ultra effort. The native editor also
 * paints recognized keywords in pixel capitals with the shared shimmer.
 */
function ModeComposer({ title, harness, draft: initialDraft = '', ultracode: initialUltracode = false, effort: initialEffort = 'high', tablet = false }: {
  title: string; harness: 'claude' | 'codex'; draft?: string; ultracode?: boolean; effort?: string; tablet?: boolean
}) {
  const { tokens: { colors } } = useMobileTheme()
  const [draft, setDraft] = useState(initialDraft)
  const controller = useRef<NativeComposerController | null>(null)
  const document = useRef<MentionDocument>([{ text: initialDraft }])
  const [editorError, setEditorError] = useState('')
  const [ultracode, setUltracode] = useState(initialUltracode)
  const [effort, setEffort] = useState(initialEffort)
  const provider: HarnessId = harness
  const mode = composerMode({
    text: draft,
    promptKeywords: HARNESS_CAPABILITIES[provider].promptKeywords,
    ultracode,
    codexReasoningEffort: harness === 'codex' ? effort as CodexReasoningEffort : null,
  })
  const { models, efforts } = MODELS[harness]
  return <View style={{ gap: 6 }}>
    <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>{title}</Text>
    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{mode ? `Mode: ${mode}` : 'No mode'}</Text>
    <View style={{ marginHorizontal: -12 }}>
      <ChatComposer {...BASE} provider={provider} draft={draft} onDraft={setDraft} composerMode={mode} tablet={tablet}
        nativeDraft={{ controller, document: document.current, onError: setEditorError, onChange: (snapshot) => {
          document.current = documentFromNativeMentions(snapshot.text, snapshot.tokens)
          setDraft(snapshot.text)
        } }}
        selection={{
          model: models[0]!.id, models, effort, efforts, onModel: noop, onEffort: setEffort,
          optionParams: harness === 'claude' ? [ultracodeOptionParam(ultracode)] : [],
          onOptionParam: (id, value) => { if (id === 'ultracode') setUltracode(value === 'true') },
        }} />
    </View>
    {editorError ? <Text accessibilityRole="alert" style={{ color: colors.foreground }}>{editorError}</Text> : null}
  </View>
}

/** Every composer mode on the phone pill and the tablet card, in both themes via the catalog's theme switch. */
export function ComposerModeGallery() {
  const { tokens: { colors } } = useMobileTheme()
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, gap: 20 }}>
    <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '500', color: colors.foreground }}>Composer modes</Text>
    <Text style={{ fontSize: 12, lineHeight: 18, color: colors.mutedForeground }}>
      Desktop parity for `ComposerModeBorder`. The border turns while the next turn runs in a special mode, whether or
      not the agent is working; Ultracode and Codex Ultra also sparkle. The native editor paints recognized keywords
      in pixel capitals with a moving glint. Reduce Motion keeps the ring and keyword colours static.
    </Text>
    <ModeComposer title="Claude · Ultracode switch on" harness="claude" ultracode />
    <ModeComposer title="Claude · ultrathink in the draft" harness="claude" draft="Find the race, ultrathink" />
    <ModeComposer title="Claude · Ultracode outranks ultrathink" harness="claude" draft="ultrathink, then ultracode the fix" />
    <ModeComposer title="Claude · a question about the keyword is not a request" harness="claude" draft="what is ultracode?" />
    <ModeComposer title="Codex · Ultra effort" harness="codex" effort="ultra" />
    <ModeComposer title="Codex · keywords do nothing" harness="codex" draft="ultrathink ultracode" />
    <ModeComposer title="Tablet card · Ultracode" harness="claude" ultracode tablet />
    <ModeComposer title="Tablet card · ultrathink" harness="claude" draft="ultrathink about the cache" tablet />
  </ScrollView>
}
