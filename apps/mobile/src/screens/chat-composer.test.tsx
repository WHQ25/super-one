import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
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
    additionalDirectories: [],
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

test('with no panel open the command list has the slot', async () => {
  await renderWithTheme(composer({ draft: '/cl', slashHits: [command('clear')] }))

  expect(screen.getByText('/clear')).toBeTruthy()
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
