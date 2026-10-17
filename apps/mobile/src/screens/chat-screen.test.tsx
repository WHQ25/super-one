import { expect, jest, test } from '@jest/globals'
import { createRef, type ReactNode } from 'react'
import { Keyboard, Text } from 'react-native'
import { screen, within } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { WebView } from 'react-native-webview'
import { renderWithTheme } from '../test-render'
import { ChatScreen } from './chat-screen'
import type { NewSessionLandingProps } from './new-session-landing'
import type { PendingPrompt } from '../pending-prompt-state'

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
  composerHidden?: boolean
  questionDocked?: boolean
  voiceComposer?: ReactNode
  inputComposer?: ReactNode
  worktreeRemoved?: boolean
  draft?: string
  collapsedPrompts?: PendingPrompt[]
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
      composerHidden={overrides.composerHidden}
      questionDocked={overrides.questionDocked}
      voiceComposer={overrides.voiceComposer}
      inputComposer={overrides.inputComposer}
      worktreeRemoved={overrides.worktreeRemoved}
      collapsedPrompts={overrides.collapsedPrompts}
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
      todos={overrides.todos ? { a: { id: 'a', subject: 'Ship it', description: '', status: 'pending' } } : {}}
      onManageDirectories={noop}
      draft={overrides.draft ?? ''}
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
      onAttachImage={noop}
      onAttachPdf={noop}
      onInsertSnippet={noop}
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
  expect(screen.getByText('Loading…')).toBeTruthy()
  // Booting under the cover is what stops WKWebView's white default from
  // flashing the moment restore finishes.
  expect(screen.getByTestId('chat-webview')).toBeTruthy()
  // The document owns the manual-only scrollbar; the native copy flashes on scrollTo.
  expect(screen.getByTestId('chat-webview').props.showsVerticalScrollIndicator).toBe(false)
  expect(screen.queryByText('Ship it')).toBeNull()
  expect(screen.queryByTestId('phone-composer-status')).toBeNull()
})

test('the first send of a new session is just the live transcript, with no starting copy', async () => {
  await renderWithTheme(screenUi())

  expect(screen.getByTestId('chat-webview')).toBeTruthy()
  expect(screen.queryByText('Starting session…')).toBeNull()
  expect(screen.queryByText('Loading…')).toBeNull()
  expect(screen.queryByTestId('conversation-loading')).toBeNull()
  expect(screen.queryByTestId('session-starting')).toBeNull()
})

test('replaces the bottom composer during voice, preserves the draft editor and restores it on hangup', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {})
  const view = await renderWithTheme(screenUi())
  dismiss.mockClear()
  await view.rerender(screenUi({ voiceComposer: <Text>Voice controls</Text>, todos: true }))
  expect(within(screen.getByTestId('chat-composer-stack')).getByText('Voice controls')).toBeTruthy()
  expect(screen.queryByLabelText('Message')).toBeNull()
  expect(screen.getByLabelText('Message', { includeHiddenElements: true })).toBeTruthy()
  expect(screen.queryByText('Ship it')).toBeNull()
  expect(dismiss).toHaveBeenCalled()
  await view.rerender(screenUi())
  expect(screen.getByLabelText('Message')).toBeTruthy()
  expect(screen.queryByText('Voice controls')).toBeNull()
  dismiss.mockRestore()
})

test('a pending native decision temporarily owns the composer slot during voice', async () => {
  await renderWithTheme(screenUi({ voiceComposer: <Text>Voice controls</Text>, inputComposer: <Text>Answer question</Text> }))
  expect(screen.getByText('Answer question')).toBeTruthy()
  expect(screen.queryByText('Voice controls')).toBeNull()
  expect(screen.queryByLabelText('Message')).toBeNull()
})

test('a docked question stands in for every composer, keeps todos and the draft editor, and dismisses the keyboard', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {})
  const view = await renderWithTheme(screenUi({ todos: true }))
  dismiss.mockClear()
  await view.rerender(screenUi({ todos: true, questionDocked: true }))
  expect(screen.queryByLabelText('Message')).toBeNull()
  expect(screen.getByLabelText('Message', { includeHiddenElements: true })).toBeTruthy()
  expect(screen.getByTestId('todo-panel')).toBeTruthy()
  expect(dismiss).toHaveBeenCalled()
  await view.rerender(screenUi({ questionDocked: true, voiceComposer: <Text>Voice controls</Text> }))
  expect(screen.queryByText('Voice controls')).toBeNull()
  await view.rerender(screenUi({ todos: true }))
  expect(screen.getByLabelText('Message')).toBeTruthy()
  dismiss.mockRestore()
})

test.each([
  { scheme: 'dark', locale: 'en', message: 'Worktree has been removed. This session is now READ ONLY.' },
  { scheme: 'light', locale: 'zh', message: 'Worktree 已删除，此会话现为只读。' },
] as const)('a removed worktree replaces every composer surface in $scheme / $locale', async ({ scheme, locale, message }) => {
  await renderWithTheme(screenUi({ worktreeRemoved: true, todos: true, draft: 'Keep this draft',
    inputComposer: <Text>Answer question</Text>, voiceComposer: <Text>Voice controls</Text>,
  }), scheme, locale)

  expect(screen.getByText(message)).toBeTruthy()
  expect(screen.getByTestId('chat-webview')).toBeTruthy()
  expect(screen.queryByLabelText('Message')).toBeNull()
  expect(screen.queryByLabelText('Send')).toBeNull()
  expect(screen.queryByTestId('todo-panel')).toBeNull()
  expect(screen.queryByText('Answer question')).toBeNull()
  expect(screen.queryByText('Voice controls')).toBeNull()
})

test('a live worktree removal dismisses the keyboard and preserves the editor through session switching', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {})
  try {
    const props = { draft: 'Keep this draft', todos: true, collapsedPrompts: [
      { kind: 'permission', request: { requestId: 'perm', toolName: 'Bash', input: { command: 'bun run build' }, allowAlwaysAllow: false } },
    ] } satisfies Parameters<typeof screenUi>[0]
    const view = await renderWithTheme(screenUi(props))
    const editor = screen.getByLabelText('Message')
    expect(screen.getByTestId('todo-panel')).toBeTruthy()
    expect(screen.getByLabelText('Bash')).toBeTruthy()
    dismiss.mockClear()

    await view.rerender(screenUi({ ...props, worktreeRemoved: true }))
    expect(screen.getByTestId('worktree-removed-banner')).toBeTruthy()
    expect(screen.queryByLabelText('Message')).toBeNull()
    expect(screen.queryByTestId('todo-panel')).toBeNull()
    expect(screen.queryByLabelText('Bash')).toBeNull()
    expect(screen.getByLabelText('Message', { includeHiddenElements: true })).toBe(editor)
    expect(dismiss).toHaveBeenCalled()

    await view.rerender(screenUi(props))
    expect(screen.queryByTestId('worktree-removed-banner')).toBeNull()
    expect(screen.getByLabelText('Message')).toBe(editor)
    expect(screen.getByTestId('todo-panel')).toBeTruthy()
    expect(editor.props.value).toBe('Keep this draft')
  } finally {
    dismiss.mockRestore()
  }
})

test('the new-session landing is not a conversation restore', async () => {
  await renderWithTheme(screenUi({ landing }))

  expect(screen.queryByText('Loading…')).toBeNull()
  expect(screen.queryByTestId('conversation-loading')).toBeNull()
  // The renderer boots hidden under the landing so the first send does not
  // remount onto WKWebView's white default.
  expect(screen.getByTestId('chat-webview')).toBeTruthy()
})

test('dismisses the keyboard when restoring a session or opening the landing', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {})
  const view = await renderWithTheme(screenUi())
  dismiss.mockClear()

  await view.rerender(screenUi({ loadingConversation: true }))
  expect(dismiss).toHaveBeenCalled()

  dismiss.mockClear()
  await view.rerender(screenUi({ landing }))
  expect(dismiss).toHaveBeenCalled()

  // The first send leaves the landing for a live transcript. That is not a
  // session switch — the keyboard stays so the next message can be typed.
  dismiss.mockClear()
  await view.rerender(screenUi())
  expect(dismiss).not.toHaveBeenCalled()
  dismiss.mockRestore()
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

test('a fullscreen MCP App hides the composer and its panels without unmounting the editor', async () => {
  const view = await renderWithTheme(screenUi({ todos: true, composerHidden: true }))

  expect(screen.getByTestId('chat-webview')).toBeTruthy()
  expect(screen.queryByLabelText('Message')).toBeNull()
  // Still mounted: a send clears the native draft after the composer is put away.
  const editor = screen.getByLabelText('Message', { includeHiddenElements: true })

  await view.rerender(screenUi({ todos: true }))
  expect(screen.getByLabelText('Message')).toBe(editor)
  expect(screen.getByTestId('todo-panel')).toBeTruthy()
})
