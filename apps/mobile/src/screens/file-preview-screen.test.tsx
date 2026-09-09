import { expect, jest, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import type { FilePreviewState } from '../file-preview-state'
import { FilePreviewScreen } from './file-preview-screen'

const PATH = '/workspace/proj/src/App.tsx'

function page(state: FilePreviewState, handlers: Partial<{ onStartTransfer: () => void; onRetry: () => void }> = {}) {
  return <FilePreviewScreen state={state} onStartTransfer={handlers.onStartTransfer ?? (() => {})} onRetry={handlers.onRetry ?? (() => {})} />
}

test('code renders one numbered row per line and marks the cited line', async () => {
  await renderWithTheme(page({
    kind: 'text', path: PATH, name: 'App.tsx', size: 30, markdown: false, line: 2,
    text: 'const a = 1\nconst b = 2\nconst c = 3\n',
  }))

  expect(screen.getByText('const a = 1')).toBeTruthy()
  expect(screen.getByText('const c = 3')).toBeTruthy()
  // The trailing newline terminates line 3; it does not add an empty line 4.
  expect(screen.queryByText('4')).toBeNull()
  expect(screen.getByTestId('file-preview-cited-line')).toBeTruthy()
})

test('markdown renders as prose, not as a listing', async () => {
  await renderWithTheme(page({
    kind: 'text', path: '/workspace/proj/README.md', name: 'README.md', size: 20, markdown: true,
    text: '# Title\n\nSome **bold** words.',
  }))

  expect(screen.getByRole('header')).toHaveTextContent('Title')
  expect(screen.queryByText('# Title')).toBeNull()
})

const RELAY_TRANSFER: FilePreviewState = {
  kind: 'transfer', path: '/workspace/proj/art/hero.png', name: 'hero.png',
  size: 4_820_113, mimeType: 'image/png', needsConfirm: true, started: false,
}

test('a relay transfer shows the size and waits for the Download tap', async () => {
  const onStartTransfer = jest.fn()
  await renderWithTheme(page(RELAY_TRANSFER, { onStartTransfer }))

  expect(screen.getByText('4.6 MB · image/png')).toBeTruthy()
  fireEvent.press(screen.getByText('Download'))
  expect(onStartTransfer).toHaveBeenCalledTimes(1)
})

test('a started relay transfer swaps the button for the hand-off note', async () => {
  await renderWithTheme(page({ ...RELAY_TRANSFER, started: true }))

  expect(screen.queryByText('Download')).toBeNull()
  expect(screen.getByText('Opening in the receive sheet…')).toBeTruthy()
})

test('a LAN transfer never shows a Download button', async () => {
  await renderWithTheme(page({
    kind: 'transfer', path: '/workspace/proj/logs/dev.log', name: 'dev.log',
    size: 2_048, mimeType: 'application/octet-stream', needsConfirm: false, started: true,
  }))

  expect(screen.queryByText('Download')).toBeNull()
  expect(screen.getByText(/downloading directly from your desktop/)).toBeTruthy()
})

test('an error offers a retry', async () => {
  const onRetry = jest.fn()
  await renderWithTheme(page({ kind: 'error', path: PATH, name: 'App.tsx', message: 'path matches blacklist' }, { onRetry }))

  expect(screen.getByRole('alert')).toHaveTextContent('path matches blacklist')
  fireEvent.press(screen.getByText('Try Again'))
  expect(onRetry).toHaveBeenCalledTimes(1)
})
