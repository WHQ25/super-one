import { expect, test } from '@jest/globals'
import { createRef } from 'react'
import { screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { WebView } from 'react-native-webview'
import { renderWithTheme } from '../test-render'
import { ChatScreen } from './chat-screen'
import type { NewSessionLandingProps } from './new-session-landing'

const noop = () => {}

const landing: NewSessionLandingProps = {
  provider: 'claude',
  harnessOptions: [{ key: 'claude', provider: 'claude', acpAgentId: null, label: 'Claude Code' }],
  activeHarnessKey: 'claude',
  onHarness: noop,
  onOpenProject: noop,
  worktreeSelection: { kind: 'local' },
  onWorktree: noop,
  onBranch: noop,
}

function screenUi(overrides: {
  loadingConversation?: boolean
  todos?: boolean
  landing?: NewSessionLandingProps
} = {}) {
  return <SafeAreaProvider initialMetrics={{
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
  }}>
    <ChatScreen
      provider="claude"
      webRef={createRef<WebView>()}
      loadingConversation={overrides.loadingConversation}
      landing={overrides.landing}
      permissionModes={['default']}
      permissionMode="default"
      sandboxInfo={null}
      contextTokens={0}
      contextWindow={200_000}
      totalCostUsd={0}
      slashHits={[]}
      slashCatalogStatus="ready"
      mentionRows={[]}
      attachments={[]}
      projectDirs={[]}
      sessionDirs={[]}
      queuedMessages={[]}
      todos={overrides.todos ? { a: { id: 'a', subject: 'Ship it', description: '', status: 'pending' } } : {}}
      onManageDirectories={noop}
      draft=""
      streaming={false}
      onWebMessage={noop}
      onWebProcessError={noop}
      onPermissionMode={noop}
      onSandboxMode={noop}
      onSlash={noop}
      onSlashDismiss={noop}
      onMention={noop}
      onRemoveAttachment={noop}
      onAttachmentMenu={noop}
      onDraft={noop}
      onSubmitFromKeyboard={noop}
      onSend={noop}
      onStop={noop}
    />
  </SafeAreaProvider>
}

test('covers the previous transcript while restore runs, without unmounting the renderer', async () => {
  await renderWithTheme(screenUi({ loadingConversation: true, todos: true }))

  expect(screen.getByTestId('conversation-loading')).toBeTruthy()
  expect(screen.getByText('Loading conversation…')).toBeTruthy()
  // Booting under the cover is what stops WKWebView's white default from
  // flashing the moment restore finishes.
  expect(screen.getByTestId('chat-webview')).toBeTruthy()
  expect(screen.queryByText('Ship it')).toBeNull()
  expect(screen.queryByTestId('phone-composer-status')).toBeNull()
})

test('the first send of a new session is just the live transcript, with no starting copy', async () => {
  await renderWithTheme(screenUi())

  expect(screen.getByTestId('chat-webview')).toBeTruthy()
  expect(screen.queryByText('Starting session…')).toBeNull()
  expect(screen.queryByText('Loading conversation…')).toBeNull()
  expect(screen.queryByTestId('conversation-loading')).toBeNull()
  expect(screen.queryByTestId('session-starting')).toBeNull()
})

test('the new-session landing is not a conversation restore', async () => {
  await renderWithTheme(screenUi({ landing }))

  expect(screen.queryByText('Loading conversation…')).toBeNull()
  expect(screen.queryByTestId('conversation-loading')).toBeNull()
  // The renderer boots hidden under the landing so the first send does not
  // remount onto WKWebView's white default.
  expect(screen.getByTestId('chat-webview')).toBeTruthy()
})

test('the new-session landing covers the hidden renderer instead of stacking below it', async () => {
  await renderWithTheme(screenUi({ landing }))

  expect(screen.getByTestId('new-session-landing')).toHaveStyle({
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  })
})
