import { expect, test } from '@jest/globals'
import { createRef } from 'react'
import { screen } from '@testing-library/react-native'
import type { WebView } from 'react-native-webview'
import { renderWithTheme } from '../test-render'
import { TerminalScreen } from './terminal-screen'

const noop = () => {}

test('keeps shortcut keys and drops the interactive-terminal heading', async () => {
  await renderWithTheme(
    <TerminalScreen webRef={createRef<WebView>()} writable onWebMessage={noop} onClaim={noop} onKey={noop} />,
  )
  expect(screen.getByLabelText('Terminal key Esc')).toBeTruthy()
  expect(screen.getByLabelText('Terminal key Ctrl-C')).toBeTruthy()
  expect(screen.queryByText('Interactive Terminal')).toBeNull()
})

test('offers take control when another client owns the session', async () => {
  await renderWithTheme(
    <TerminalScreen webRef={createRef<WebView>()} writable={false} onWebMessage={noop} onClaim={noop} onKey={noop} />,
  )
  expect(screen.getByText('Read-only · another client has control')).toBeTruthy()
  expect(screen.getByText('Take Control')).toBeTruthy()
})
