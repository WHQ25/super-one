import { expect, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { Text } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { renderWithTheme } from '../test-render'
import type { MatchedSlashCommand } from '../slash'
import { ChatComposer, type ChatComposerProps } from './chat-composer'

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

test('renders every prompt suggestion as a chip, including the first', async () => {
  // Desktop keeps the first one as ghost text and accepts it with Tab. There is
  // no Tab here, so a first suggestion left off the row would be unreachable.
  await renderWithTheme(composer({ promptSuggestions: FOLLOW_UPS }))

  expect(screen.getByTestId('prompt-suggestions')).toBeTruthy()
  expect(screen.getByLabelText('Explain the diff first')).toBeTruthy()
  expect(screen.getByLabelText('Run the affected tests')).toBeTruthy()
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

test('prompt suggestions stay off while a turn is streaming', async () => {
  await renderWithTheme(composer({ promptSuggestions: FOLLOW_UPS, streaming: true }))

  expect(screen.queryByTestId('prompt-suggestions')).toBeNull()
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
