import { beforeAll, expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Locale } from '@superone/shared/agent-types'
import type { FilePreviewState } from '../file-preview-state'
import type { MediaPorts } from '../media-ports'
import { createFakeMediaPorts } from '../preview/fake-media-ports'
import { renderWithTheme } from '../test-render'
import { FilePreviewModal } from './file-preview'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const PATH = '/workspace/proj/src/App.tsx'

const IMAGE: FilePreviewState = { kind: 'image', path: '/shots/a.png', name: 'a.png', label: 'Screenshot', src: PNG, mimeType: 'image/png' }
const TEXT: FilePreviewState = { kind: 'text', path: PATH, name: 'App.tsx', size: 30, markdown: false, line: 2, text: 'const a = 1\nconst b = 2\nconst c = 3\n' }
const RELAY_TRANSFER: FilePreviewState = {
  kind: 'transfer', path: '/workspace/proj/art/hero.png', name: 'hero.png', size: 4_820_113, mimeType: 'image/png', needsConfirm: true, phase: 'idle',
}

// The menu anchors on the trigger's measured frame; the host-component mock
// measures nothing, so the menu would never open without a size to report.
beforeAll(() => {
  const proto = View.prototype as unknown as { measureInWindow: jest.Mock<(cb: (x: number, y: number, w: number, h: number) => void) => void> }
  proto.measureInWindow.mockImplementation((callback) => callback(340, 50, 40, 40))
})

/** Open the more menu and tap one of its rows, letting the async action settle. */
async function runMenuAction(label: string) {
  // Opening measures the trigger and mounts the menu in a passive effect, so the
  // press is wrapped too or that mount lands outside act.
  await act(async () => { fireEvent.press(screen.getByLabelText('More')) })
  const row = await screen.findByLabelText(label)
  await act(async () => { fireEvent.press(row) })
  return row
}

function mount(
  state: FilePreviewState | null,
  options: { ports?: MediaPorts; onDismiss?: () => void; onStartTransfer?: () => void; onRetry?: () => void; locale?: Locale } = {},
) {
  // The chrome reads the status-bar inset directly; outside a provider that hook throws.
  return renderWithTheme(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <FilePreviewModal
        state={state}
        ports={options.ports ?? createFakeMediaPorts()}
        onDismiss={options.onDismiss ?? (() => {})}
        onStartTransfer={options.onStartTransfer ?? (() => {})}
        onRetry={options.onRetry ?? (() => {})}
      />
    </SafeAreaProvider>,
    'dark',
    options.locale ?? 'en',
  )
}

test('shows nothing until something is requested', async () => {
  await mount(null)
  expect(screen.queryByLabelText('Close')).toBeNull()
})

test('a picture shows its label with close and the more menu', async () => {
  await mount(IMAGE)
  expect(screen.getByText('Screenshot')).toBeTruthy()
  expect(screen.getByLabelText('Close')).toBeTruthy()
  expect(screen.getByLabelText('More')).toBeTruthy()
})

test('the close button dismisses the viewer', async () => {
  const onDismiss = jest.fn()
  await mount(IMAGE, { onDismiss })
  fireEvent.press(screen.getByLabelText('Close'))
  expect(onDismiss).toHaveBeenCalledTimes(1)
})

test('the menu saves a picture to Photos and reports it', async () => {
  const calls: string[] = []
  await mount(IMAGE, { ports: createFakeMediaPorts({ onCall: (action) => calls.push(action) }) })
  await runMenuAction('Save to Photos')
  expect(await screen.findByText('Saved to Photos')).toBeTruthy()
  expect(calls).toEqual(['save'])
})

test('a denied photo permission offers Settings', async () => {
  const calls: string[] = []
  await mount(IMAGE, { ports: createFakeMediaPorts({ save: 'denied', onCall: (action) => calls.push(action) }) })
  await runMenuAction('Save to Photos')
  fireEvent.press(await screen.findByText('Open Settings'))
  expect(calls).toEqual(['save', 'openSettings'])
})

test('the menu shares through the ports', async () => {
  const calls: string[] = []
  await mount(IMAGE, { ports: createFakeMediaPorts({ onCall: (action) => calls.push(action) }) })
  await runMenuAction('Share')
  expect(calls).toEqual(['share'])
  // Nothing to report on success: the share sheet was the feedback.
  expect(screen.queryByText('Saved')).toBeNull()
})

test('a share failure is shown in the chrome', async () => {
  await mount(IMAGE, { ports: createFakeMediaPorts({ share: 'throw' }) })
  await runMenuAction('Share')
  expect(await screen.findByText('Sharing is unavailable on this device')).toBeTruthy()
})

test('a remote URL disables both rows because there are no bytes on the phone', async () => {
  const calls: string[] = []
  await mount({ kind: 'image', name: 'image.png', src: 'https://example.com/a.png', mimeType: 'image/png' },
    { ports: createFakeMediaPorts({ onCall: (action) => calls.push(action) }) })
  const save = await runMenuAction('Save to Photos')
  expect(save).toBeDisabled()
  expect(screen.getByLabelText('Share')).toBeDisabled()
  expect(calls).toEqual([])
})

test('text offers Save to Files, renders a numbered listing and marks the cited line', async () => {
  await mount(TEXT)
  expect(screen.getByText('App.tsx')).toBeTruthy()
  expect(screen.getByText('const a = 1')).toBeTruthy()
  expect(screen.getByText('const c = 3')).toBeTruthy()
  // The trailing newline terminates line 3; it does not add an empty line 4.
  expect(screen.queryByText('4')).toBeNull()
  expect(screen.getByTestId('file-preview-cited-line')).toBeTruthy()
  await act(async () => { fireEvent.press(screen.getByLabelText('More')) })
  expect(await screen.findByText('Save to Files')).toBeTruthy()
})

test('markdown renders as prose, not as a listing', async () => {
  await mount({ kind: 'text', path: '/workspace/proj/README.md', name: 'README.md', size: 20, markdown: true, text: '# Title\n\nSome **bold** words.' })
  expect(screen.getByRole('header')).toHaveTextContent('Title')
  expect(screen.queryByText('# Title')).toBeNull()
})

test('a relay transfer shows the size and waits for the Download tap', async () => {
  const onStartTransfer = jest.fn()
  await mount(RELAY_TRANSFER, { onStartTransfer })
  expect(screen.getByText('4.6 MB · image/png')).toBeTruthy()
  fireEvent.press(screen.getByText('Download'))
  expect(onStartTransfer).toHaveBeenCalledTimes(1)
})

test('a downloading transfer swaps the button for progress copy', async () => {
  await mount({ ...RELAY_TRANSFER, phase: 'downloading' })
  expect(screen.queryByText('Download')).toBeNull()
  expect(screen.getByText('Downloading securely…')).toBeTruthy()
})

test('a LAN transfer never shows a Download button', async () => {
  await mount({ kind: 'transfer', path: '/workspace/proj/logs/dev.log', name: 'dev.log', size: 2_048, mimeType: 'application/octet-stream', needsConfirm: false, phase: 'downloading' })
  expect(screen.queryByText('Download')).toBeNull()
  expect(screen.getByText(/downloading directly from your desktop/)).toBeTruthy()
})

test('a finished transfer points at the menu, which now saves to a folder', async () => {
  const calls: string[] = []
  await mount({ ...RELAY_TRANSFER, name: 'spec.pdf', mimeType: 'application/pdf', phase: 'ready', localUri: 'file:///cache/spec.pdf' },
    { ports: createFakeMediaPorts({ onCall: (action) => calls.push(action) }) })
  expect(screen.getByText('Downloaded. Use the menu to save or share it.')).toBeTruthy()
  await runMenuAction('Save to Files')
  expect(await screen.findByText('Saved')).toBeTruthy()
  expect(calls).toEqual(['save'])
})

test('an error offers a retry', async () => {
  const onRetry = jest.fn()
  await mount({ kind: 'error', path: PATH, name: 'App.tsx', message: 'path matches blacklist' }, { onRetry })
  expect(screen.getByRole('alert')).toHaveTextContent('path matches blacklist')
  fireEvent.press(screen.getByText('Try Again'))
  expect(onRetry).toHaveBeenCalledTimes(1)
})

test('translates its chrome and menu', async () => {
  await mount(IMAGE, { locale: 'zh' })
  expect(screen.getByLabelText('关闭')).toBeTruthy()
  await act(async () => { fireEvent.press(screen.getByLabelText('更多')) })
  expect(await screen.findByText('保存到相册')).toBeTruthy()
  expect(screen.getByText('分享')).toBeTruthy()
})
