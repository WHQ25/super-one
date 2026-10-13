import { beforeAll, expect, jest, test } from '@jest/globals'
import { act, fireEvent, render, screen, within } from '@testing-library/react-native'
import { DeviceEventEmitter, Text, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { renderWithTheme } from '../test-render'
import type { MatchedSlashCommand } from '../slash'
import { ChatComposer, type ChatComposerProps } from './chat-composer'
import { ultracodeOptionParam } from '../model-picker-state'
import { MobileVoiceEntry } from '../voice/mobile-voice-controls'
import type { ScheduledSendControls } from '../navigation/use-scheduled-send'
import { MobileThemeProvider } from '../theme/context'

beforeAll(() => {
  const measure = View.prototype.measureInWindow as jest.Mock<typeof View.prototype.measureInWindow>
  measure.mockImplementation(callback => callback(10, 500, 44, 44))
})

const scheduledSendControls = (overrides: Partial<ScheduledSendControls> = {}): ScheduledSendControls => ({
  scheduled: null, available: true, loading: false, busy: false, error: '',
  schedule: async () => {}, accept: async () => {}, cancel: async () => {}, dismiss: async () => {},
  ...overrides,
})

async function renderScheduledComposer(props: Partial<ChatComposerProps>, colorScheme: 'light' | 'dark' = 'dark', locale: 'en' | 'zh' = 'en') {
  // The menu portal belongs to the theme provider, so its safe area must wrap
  // that provider as it does in the app, rather than only wrapping the editor.
  const wrap = (next: Partial<ChatComposerProps>) => <SafeAreaProvider initialMetrics={{
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
  }}><MobileThemeProvider colorScheme={colorScheme} locale={locale}>{composer(next)}</MobileThemeProvider></SafeAreaProvider>
  const result = await render(wrap(props))
  return { ...result, rerender: (next: Partial<ChatComposerProps>) => result.rerender(wrap(next)) }
}

test('an empty Codex composer exposes voice at the right of its input before the first message', async () => {
  await renderWithTheme(composer({ provider: 'codex', voiceEntry: <MobileVoiceEntry enabled busy={false} onStart={() => {}} /> }))
  expect(within(screen.getByTestId('composer-input-row')).getByLabelText('Start voice')).toBeTruthy()
  expect(within(screen.getByTestId('phone-composer-status')).queryByLabelText('Start voice')).toBeNull()
})

test('moves voice and send together onto the expanded phone action row, voice first', async () => {
  const actions: string[] = []
  await renderWithTheme(composer({ provider: 'codex', focused: true, draft: 'Saved draft',
    onSend: () => actions.push('send'), voiceEntry: <MobileVoiceEntry enabled busy={false} onStart={() => actions.push('voice')} /> }))
  const row = within(screen.getByTestId('phone-composer-actions'))
  expect(row.getByLabelText('Start voice')).toBeTruthy()
  expect(row.getByLabelText('Send')).toBeTruthy()
  expect(within(screen.getByTestId('composer-input-row')).queryByLabelText('Start voice')).toBeNull()
  expect(within(screen.getByTestId('composer-input-row')).queryByLabelText('Send')).toBeNull()
  expect(within(screen.getByTestId('phone-composer-delivery')).getAllByRole('button').map(button => button.props.accessibilityLabel)).toEqual(['Start voice', 'Send'])
  await act(async () => { fireEvent.press(row.getByLabelText('Start voice')) })
  await act(async () => { fireEvent.press(row.getByLabelText('Send')) })
  expect(actions).toEqual(['voice', 'send'])
})

test('keeps both delivery modes inside the collapsed phone input, voice first', async () => {
  await renderWithTheme(composer({ provider: 'codex', focused: false, draft: 'Saved draft', voiceEntry: <MobileVoiceEntry enabled busy={false} onStart={() => {}} /> }))
  const row = within(screen.getByTestId('composer-input-row'))
  expect(row.getByLabelText('Start voice')).toBeTruthy()
  expect(row.getByLabelText('Send')).toBeTruthy()
  expect(within(screen.getByTestId('phone-composer-delivery')).getAllByRole('button').map(button => button.props.accessibilityLabel)).toEqual(['Start voice', 'Send'])
  expect(screen.queryByTestId('phone-composer-actions')).toBeNull()
  expect(screen.getAllByLabelText('Start voice')).toHaveLength(1)
  expect(screen.getAllByLabelText('Send')).toHaveLength(1)
})

test('shows voice alone in the expanded action row when there is no message', async () => {
  await renderWithTheme(composer({ provider: 'codex', focused: true, voiceEntry: <MobileVoiceEntry enabled busy={false} onStart={() => {}} /> }))
  expect(within(screen.getByTestId('phone-composer-actions')).getByLabelText('Start voice')).toBeTruthy()
  expect(within(screen.getByTestId('composer-input-row')).queryByLabelText('Start voice')).toBeNull()
  expect(screen.queryByLabelText('Send')).toBeNull()
})

test('places the tablet voice entry last in the composer toolbar', async () => {
  await renderWithTheme(composer({ provider: 'codex', tablet: true, draft: 'Saved draft', voiceEntry: <MobileVoiceEntry enabled busy={false} onStart={() => {}} /> }))
  const entry = screen.getByTestId('composer-voice-entry')
  expect(entry.parent?.children.at(-1)).toBe(entry)
  expect(within(screen.getByTestId('tablet-composer')).getByLabelText('Start voice')).toBeTruthy()
})

function command(name: string): MatchedSlashCommand {
  return { name, description: '', argumentHint: '', isSkill: false, matchIndices: [], score: 0, matched: true }
}

function composer(overrides: Partial<ChatComposerProps> = {}) {
  const props: ChatComposerProps = {
    provider: 'claude',
    draft: '',
    streaming: false,
    attachments: [],
    permissionModes: ['default'],
    permissionMode: 'default',
    projectDirs: [],
    sessionDirs: [],
    onManageDirectories: () => {},
    sandboxInfo: null,
    contextTokens: 0,
    contextWindow: 200_000,
    totalCostUsd: 0,
    slashHits: [],
    slashCatalogStatus: 'ready',
    mentionRows: [],
    onDraft: () => {},
    onSend: () => {},
    onStop: () => {},
    onSubmitFromKeyboard: () => {},
    onAttachmentMenu: () => {},
    onAttachImage: () => {},
    onAttachPdf: () => {},
    onInsertSnippet: () => {},
    onRemoveAttachment: () => {},
    onPermissionMode: () => {},
    onSandboxMode: () => {},
    onSlash: () => {},
    onSlashDismiss: () => {},
    onMention: () => {},
    ...overrides,
  }
  // The composer reads the home-indicator inset directly; outside a provider
  // that hook throws rather than defaulting.
  return <SafeAreaProvider initialMetrics={{
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
  }}><ChatComposer {...props} /></SafeAreaProvider>
}

test('the folder count rides in the status row, counting both scopes', async () => {
  // The row it replaced showed only the project's folders, so one added to the
  // session on the landing appeared nowhere and read as a failed write.
  await renderWithTheme(composer({ projectDirs: ['/a'], sessionDirs: ['/b'] }))

  expect(screen.getByLabelText('Additional Folders: 2')).toBeTruthy()
  expect(screen.getByTestId('phone-composer-status')).toBeTruthy()
})

test('OpenCode has a separate native agent trigger, and the model trigger only names model and effort', async () => {
  await renderWithTheme(composer({
    provider: 'opencode', permissionModes: [],
    selection: {
      model: 'openai/gpt', models: [{ id: 'openai/gpt', name: 'GPT', description: '' }],
      effort: 'high', efforts: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }],
      onModel: () => {}, onEffort: () => {},
      agents: [{ id: 'plan', name: 'Plan' }], agent: 'plan', onAgent: () => {},
    },
  }))
  expect(screen.getByLabelText('Agent: Plan')).toBeTruthy()
  expect(screen.getByLabelText('Model: GPT, High')).toBeTruthy()
  expect(screen.queryByLabelText(/Permission [Mm]ode:/)).toBeNull()
})

test('OpenCode displays Default without a permission mode chip when its catalog is empty', async () => {
  await renderWithTheme(composer({
    provider: 'opencode', permissionModes: [],
    selection: {
      model: '', models: [], effort: '', efforts: [], onModel: () => {}, onEffort: () => {},
      agents: [], agent: null, onAgent: () => {},
    },
  }))
  expect(screen.getByLabelText('Agent: Default')).toBeTruthy()
  expect(screen.queryByLabelText(/Permission [Mm]ode:/)).toBeNull()
})

test('with no panel open the command list has the slot', async () => {
  await renderWithTheme(composer({ draft: '/cl', slashHits: [command('clear')] }))

  expect(screen.getByText('/clear')).toBeTruthy()
})

test('hides the chips above the input while a session is loading', async () => {
  await renderWithTheme(composer({
    loadingConversation: true,
    projectDirs: ['/a'],
    selection: {
      model: 'sonnet', models: [{ id: 'sonnet', name: 'Sonnet', description: '' }],
      effort: '', efforts: [], onModel: () => {}, onEffort: () => {},
    },
  }))

  expect(screen.queryByTestId('phone-composer-status')).toBeNull()
})

test('a panel takes the slot from the command list rather than stacking on it', async () => {
  // The panel a command opens is answering the same keystrokes the list is.
  // Both at once is what `/add-dir` looked like: a folder panel drawn over a
  // list still offering `/add-dir`.
  await renderWithTheme(composer({
    draft: '/add-dir',
    slashHits: [command('add-dir')],
    overlay: <Text>Additional folders</Text>,
  }))

  expect(screen.getByText('Additional folders')).toBeTruthy()
  expect(screen.queryByText('/add-dir')).toBeNull()
})

const FOLLOW_UPS = ['Explain the diff first', 'Run the affected tests']

test('renders every prompt suggestion as a row, including the first', async () => {
  // Desktop keeps the first one as ghost text and accepts it with Tab. There is
  // no Tab here, so a first suggestion left off the list would be unreachable.
  await renderWithTheme(composer({ promptSuggestions: FOLLOW_UPS }))

  expect(screen.getByTestId('prompt-suggestions')).toBeTruthy()
  expect(screen.getByText('Suggestions')).toBeTruthy()
  expect(screen.getByLabelText('Explain the diff first')).toBeTruthy()
  expect(screen.getByLabelText('Run the affected tests')).toBeTruthy()
})

test('prompt suggestions leave once the draft has content', async () => {
  // The panel offers something to say; once the user is saying something it
  // would only push the input further from the message it answers.
  await renderWithTheme(composer({ promptSuggestions: FOLLOW_UPS, draft: 'Run them' }))

  expect(screen.queryByTestId('prompt-suggestions')).toBeNull()
})

test('a tapped suggestion is reported rather than sent', async () => {
  const picked: string[] = []
  await renderWithTheme(composer({ promptSuggestions: FOLLOW_UPS, onPromptSuggestion: (s) => picked.push(s) }))

  fireEvent.press(screen.getByLabelText('Run the affected tests'))

  expect(picked).toEqual(['Run the affected tests'])
})

test('prompt suggestions yield the slot to the command list', async () => {
  // Same rule as the panel above: a typed `/` is an answer in progress, and the
  // turn's follow-ups are not competing for those keystrokes.
  await renderWithTheme(composer({
    promptSuggestions: FOLLOW_UPS,
    draft: '/cl',
    slashHits: [command('clear')],
  }))

  expect(screen.queryByTestId('prompt-suggestions')).toBeNull()
  expect(screen.getByText('/clear')).toBeTruthy()
})

test('the dismiss on the suggestions title reports without selecting', async () => {
  const picked: string[] = []
  let dismissed = 0
  await renderWithTheme(composer({
    promptSuggestions: FOLLOW_UPS,
    onPromptSuggestion: (s) => picked.push(s),
    onPromptSuggestionsDismiss: () => { dismissed += 1 },
  }))

  fireEvent.press(screen.getByLabelText('Hide Suggestions'))

  expect(dismissed).toBe(1)
  expect(picked).toEqual([])
})

test('prompt suggestions stay off while a turn is streaming', async () => {
  await renderWithTheme(composer({ promptSuggestions: FOLLOW_UPS, streaming: true }))

  expect(screen.queryByTestId('prompt-suggestions')).toBeNull()
})

test('a phone drops the paperclip and keeps Send on the input row until focus', async () => {
  await renderWithTheme(composer({ tablet: false, draft: 'hello' }))

  expect(screen.queryByLabelText('Add Attachment')).toBeNull()
  expect(screen.queryByTestId('phone-composer-actions')).toBeNull()
  expect(screen.getByLabelText('Send')).toBeTruthy()
})

test('an empty composer hides Send until there is something to send', async () => {
  await renderWithTheme(composer({ tablet: false }))

  expect(screen.queryByTestId('phone-composer-actions')).toBeNull()
  expect(screen.queryByLabelText('Send')).toBeNull()
})

test('an empty tablet composer hides Send inside the boxed row', async () => {
  await renderWithTheme(composer({ tablet: true }))

  expect(screen.queryByLabelText('Send')).toBeNull()
  expect(screen.getByLabelText('Add Attachment')).toBeTruthy()
})

test('an empty unfocused streaming phone keeps Stop on the input row without Send', async () => {
  await renderWithTheme(composer({ tablet: false, streaming: true }))

  expect(screen.queryByTestId('phone-composer-actions')).toBeNull()
  expect(screen.queryByLabelText('Send')).toBeNull()
  expect(screen.getByLabelText('Stop')).toBeTruthy()
})

test('keyboard transitions move both delivery modes together and retain the draft', async () => {
  await renderWithTheme(composer({ tablet: false, draft: 'hello', voiceEntry: <MobileVoiceEntry enabled busy={false} onStart={() => {}} /> }))
  const editor = screen.getByLabelText('Message')
  expect(within(screen.getByTestId('composer-input-row')).getByLabelText('Send')).toBeTruthy()
  await act(async () => {
    fireEvent(screen.getByLabelText('Message'), 'focus')
    DeviceEventEmitter.emit('keyboardWillShow', { endCoordinates: { screenY: 500, height: 350 } })
    DeviceEventEmitter.emit('keyboardDidShow', { endCoordinates: { screenY: 500, height: 350 } })
  })
  expect(screen.getByTestId('phone-composer-actions')).toBeTruthy()
  expect(within(screen.getByTestId('phone-composer-actions')).getByLabelText('Start voice')).toBeTruthy()
  expect(within(screen.getByTestId('phone-composer-actions')).getByLabelText('Send')).toBeTruthy()

  await act(async () => {
    DeviceEventEmitter.emit('keyboardWillHide', { endCoordinates: { screenY: 850, height: 0 } })
    DeviceEventEmitter.emit('keyboardDidHide', { endCoordinates: { screenY: 850, height: 0 } })
  })
  expect(screen.queryByTestId('phone-composer-actions')).toBeNull()
  expect(within(screen.getByTestId('composer-input-row')).getByLabelText('Start voice')).toBeTruthy()
  expect(within(screen.getByTestId('composer-input-row')).getByLabelText('Send')).toBeTruthy()
  expect(screen.getByLabelText('Message')).toBe(editor)
  expect(editor.props.value).toBe('hello')
})

test('focusing the phone input opens the action bar and moves Send onto it', async () => {
  const inserted: string[] = []
  await renderWithTheme(composer({
    tablet: false,
    focused: true,
    draft: 'hello',
    onInsertSnippet: (snippet) => { inserted.push(snippet) },
  }))

  expect(screen.getByTestId('phone-composer-actions')).toBeTruthy()
  expect(screen.getByLabelText('Add Image')).toBeTruthy()
  expect(screen.getByLabelText('Add PDF')).toBeTruthy()
  expect(screen.getByLabelText('Insert Slash Command')).toBeTruthy()
  expect(screen.getByLabelText('Insert Mention')).toBeTruthy()
  expect(screen.getByLabelText('Send')).toBeTruthy()
  expect(screen.queryByLabelText('Add Attachment')).toBeNull()

  fireEvent.press(screen.getByLabelText('Insert Slash Command'))
  expect(inserted).toEqual(['/'])
})

test('a focused streaming phone keeps Send as queue and shows Stop beside it', async () => {
  await renderWithTheme(composer({ tablet: false, focused: true, streaming: true, draft: 'hello' }))

  expect(screen.getByTestId('phone-composer-actions')).toBeTruthy()
  expect(screen.getByLabelText('Send')).toBeTruthy()
  expect(screen.getByLabelText('Stop')).toBeTruthy()
})

test.each([
  { tablet: false, focused: false, colorScheme: 'dark', locale: 'en' },
  { tablet: false, focused: true, colorScheme: 'dark', locale: 'en' },
  { tablet: true, focused: true, colorScheme: 'dark', locale: 'en' },
  { tablet: false, focused: true, colorScheme: 'light', locale: 'zh' },
] as const)('streaming keeps scheduling behind long press with layout %p', async ({ tablet, focused, colorScheme, locale }) => {
  const onSend = jest.fn()
  const props = { tablet, focused, hasConversation: true, scheduledSend: scheduledSendControls(), onSend }
  const labels = locale === 'zh'
    ? { send: '发送', schedule: '定时发送', stop: '停止', date: '发送日期', close: '关闭 定时发送' }
    : { send: 'Send', schedule: 'Schedule Send', stop: 'Stop', date: 'Scheduled Date', close: 'Close Scheduled Send' }
  const view = await renderScheduledComposer({ ...props, draft: 'First message' }, colorScheme, locale)
  expect(screen.getByLabelText(labels.send)).toBeTruthy()

  await view.rerender(props)
  expect(screen.queryByLabelText(labels.send)).toBeNull()
  expect(screen.queryByLabelText(labels.schedule)).toBeNull()

  await view.rerender({ ...props, streaming: true })
  expect(screen.queryByLabelText(labels.send)).toBeNull()
  expect(screen.queryByLabelText(labels.schedule)).toBeNull()
  expect(screen.getByLabelText(labels.stop)).toBeTruthy()

  await view.rerender({ ...props, streaming: true, draft: 'Next message' })
  await act(async () => { fireEvent.press(screen.getByLabelText(labels.send)) })
  expect(onSend).toHaveBeenCalledTimes(1)
  expect(screen.queryByLabelText(labels.date)).toBeNull()

  await act(async () => { fireEvent(screen.getByLabelText(labels.send), 'longPress') })
  expect(screen.getByLabelText(labels.date)).toBeTruthy()
  expect(onSend).toHaveBeenCalledTimes(1)
  await act(async () => { fireEvent.press(screen.getByLabelText(labels.close)) })
  expect(screen.queryByLabelText(labels.date)).toBeNull()
})

test('an unarmed quota offer does not replace empty Send with a scheduling button', async () => {
  await renderScheduledComposer({ hasConversation: true, streaming: true,
    scheduledSend: scheduledSendControls({ scheduled: {
      sessionId: 's', sendAt: Date.now() + 3_600_000, armed: false, source: 'rate_limit', message: null,
    } }),
  })
  expect(screen.queryByLabelText('Send')).toBeNull()
  expect(screen.queryByLabelText('Schedule Send')).toBeNull()
  expect(screen.getByLabelText('Stop')).toBeTruthy()
})

test('an armed schedule remains accessible with an empty draft', async () => {
  await renderScheduledComposer({ hasConversation: true, streaming: true,
    scheduledSend: scheduledSendControls({ scheduled: {
      sessionId: 's', sendAt: Date.now() + 3_600_000, armed: true, source: 'manual', message: null,
    } }),
  })
  await act(async () => { fireEvent.press(screen.getByLabelText('Scheduled Send')) })
  expect(screen.getByLabelText('Cancel Scheduled Send')).toBeTruthy()
})

test('cancelling an empty scheduled prompt keeps setup open until the user dismisses it', async () => {
  const scheduledSend = scheduledSendControls({ scheduled: {
    sessionId: 's', sendAt: Date.now() + 3_600_000, armed: true, source: 'rate_limit', message: null,
  } })
  const props = { hasConversation: true, scheduledSend }
  const view = await renderScheduledComposer(props)
  await act(async () => { fireEvent.press(screen.getByLabelText('Scheduled Send')) })
  expect(screen.queryByLabelText('Scheduled Date')).toBeNull()
  await act(async () => { fireEvent.press(screen.getByLabelText('Cancel Scheduled Send')) })
  await view.rerender({ ...props, scheduledSend: { ...scheduledSend, scheduled: { ...scheduledSend.scheduled!, armed: false } } })
  expect(screen.getByLabelText('Scheduled Date')).toBeTruthy()
  await act(async () => { fireEvent.press(screen.getByLabelText('Close Scheduled Send')) })
  expect(screen.queryByLabelText('Scheduled Date')).toBeNull()
  expect(screen.queryByLabelText('Send')).toBeNull()
})

test('a scheduling error keeps a short tap as Send and exposes retry on long press', async () => {
  const onSend = jest.fn()
  await renderScheduledComposer({ hasConversation: true, streaming: true, draft: 'Next message', onSend,
    scheduledSend: scheduledSendControls({ available: false, error: 'Schedule lookup failed', retry: async () => {} }),
  })
  await act(async () => { fireEvent.press(screen.getByLabelText('Send')) })
  expect(onSend).toHaveBeenCalledTimes(1)
  expect(screen.queryByLabelText('Retry')).toBeNull()
  await act(async () => { fireEvent(screen.getByLabelText('Send'), 'longPress') })
  expect(screen.getByLabelText('Retry')).toBeTruthy()
  expect(onSend).toHaveBeenCalledTimes(1)
})

test('a streaming Claude action bar offers steer now and steer soon', async () => {
  await renderWithTheme(composer({
    tablet: false, focused: true, streaming: true, draft: 'hello',
    canSteer: true, canSteerSoon: true,
  }))

  expect(screen.getByLabelText('Steer Now')).toBeTruthy()
  expect(screen.getByLabelText('Steer Soon')).toBeTruthy()
})

test('a streaming Codex action bar offers steer now only', async () => {
  await renderWithTheme(composer({
    tablet: false, focused: true, streaming: true, draft: 'hello',
    canSteer: true, canSteerSoon: false,
  }))

  expect(screen.getByLabelText('Steer Now')).toBeTruthy()
  expect(screen.queryByLabelText('Steer Soon')).toBeNull()
})

test('a streaming action bar hides send and steer until the input has content', async () => {
  await renderWithTheme(composer({
    tablet: false, focused: true, streaming: true,
    canSteer: true, canSteerSoon: true,
  }))

  expect(screen.queryByLabelText('Send')).toBeNull()
  expect(screen.queryByLabelText('Steer Now')).toBeNull()
  expect(screen.queryByLabelText('Steer Soon')).toBeNull()
  expect(screen.getByLabelText('Stop')).toBeTruthy()
})

test('a tablet keeps the paperclip and boxed send row, without the phone action bar', async () => {
  await renderWithTheme(composer({ tablet: true, focused: true, draft: 'hello' }))

  expect(screen.getByLabelText('Add Attachment')).toBeTruthy()
  expect(screen.queryByTestId('phone-composer-actions')).toBeNull()
  expect(screen.getByLabelText('Send')).toBeTruthy()
})

test('a landscape phone keeps the compact input, not the boxed tablet card', async () => {
  await renderWithTheme(composer({ tablet: false }))

  expect(screen.getByTestId('phone-composer')).toBeTruthy()
  expect(screen.queryByTestId('tablet-composer')).toBeNull()
})

test('a tall tablet window uses the boxed composer', async () => {
  await renderWithTheme(composer({ tablet: true }))

  expect(screen.getByTestId('tablet-composer')).toBeTruthy()
  expect(screen.queryByTestId('phone-composer')).toBeNull()
})


test('Send is disabled while restoring, then works as soon as the conversation is ready', async () => {
  let taps = 0
  const view = await renderWithTheme(composer({ draft: '你好', loadingConversation: true, onSend: () => { taps++ } }))
  expect(screen.getByLabelText('Send').props.accessibilityState.disabled).toBe(true)
  fireEvent.press(screen.getByLabelText('Send'))
  expect(taps).toBe(0)
  await view.rerender(composer({ draft: '你好', loadingConversation: false, onSend: () => { taps++ } }))
  fireEvent.press(screen.getByLabelText('Send'))
  expect(taps).toBe(1)
})

test('a special next turn draws its mode border on the phone and tablet input, and only once the session is shown', async () => {
  await renderWithTheme(composer({ composerMode: 'ultracode' }))
  expect(screen.getByTestId('composer-mode-border')).toBeTruthy()

  await renderWithTheme(composer({ composerMode: 'codex-ultra', tablet: true }))
  expect(screen.getByTestId('composer-mode-border')).toBeTruthy()

  await renderWithTheme(composer({ composerMode: 'ultrathink', loadingConversation: true }))
  expect(screen.queryByTestId('composer-mode-border')).toBeNull()

  await renderWithTheme(composer({ composerMode: null }))
  expect(screen.queryByTestId('composer-mode-border')).toBeNull()
})

test('the model trigger carries Ultracode\'s mark while the switch is on, as the desktop selector does', async () => {
  const selection = (on: boolean): ChatComposerProps['selection'] => ({
    model: 'opus', models: [{ id: 'opus', name: 'Opus', description: '', supportedEffortLevels: ['high', 'xhigh'] }],
    effort: 'high', efforts: [{ value: 'high', label: 'High' }, { value: 'xhigh', label: 'Extra High' }],
    onModel: () => {}, onEffort: () => {}, optionParams: [ultracodeOptionParam(on)], onOptionParam: () => {},
  })
  await renderWithTheme(composer({ selection: selection(true) }))
  expect(screen.getByLabelText('Model: Opus, High, Ultracode')).toBeTruthy()

  await renderWithTheme(composer({ selection: selection(false) }))
  expect(screen.getByLabelText('Model: Opus, High')).toBeTruthy()
})
