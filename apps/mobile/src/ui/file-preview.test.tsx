import { beforeAll, expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import * as Clipboard from 'expo-clipboard'
import { Animated, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Locale } from '@superone/shared/agent-types'
import type { FilePreviewState } from '../file-preview-state'
import type { ImageGenerationPorts } from '../image-generation-ports'
import type { MediaPorts } from '../media-ports'
import { createFakeGenerationPorts } from '../preview/fake-generation-ports'
import { createFakeMediaPorts } from '../preview/fake-media-ports'
import { renderWithTheme } from '../test-render'
import { FilePreviewModal } from './file-preview'

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
}))

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
  // Native-driver animations look up a view tag the host-component tree never has.
  const animation = { start: (cb?: (result: { finished: boolean }) => void) => { cb?.({ finished: true }) }, stop: () => {}, reset: () => {} }
  jest.spyOn(Animated, 'timing').mockReturnValue(animation as Animated.CompositeAnimation)
  jest.spyOn(Animated, 'spring').mockReturnValue(animation as Animated.CompositeAnimation)
  jest.spyOn(Animated, 'parallel').mockReturnValue(animation as Animated.CompositeAnimation)
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
  options: { ports?: MediaPorts; generationPorts?: ImageGenerationPorts; onDismiss?: () => void; onStartTransfer?: () => void; onRetry?: () => void; locale?: Locale } = {},
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
        generationPorts={options.generationPorts}
      />
    </SafeAreaProvider>,
    'dark',
    options.locale ?? 'en',
  )
}

test('shows nothing until something is requested', async () => {
  await mount(null)
  expect(screen.queryByLabelText('Back')).toBeNull()
})

test('a picture shows its label with back, rotation and the more menu', async () => {
  await mount(IMAGE)
  expect(screen.getByText('Screenshot')).toBeTruthy()
  expect(screen.getByTestId('file-preview-type-icon')).toBeTruthy()
  expect(screen.getByLabelText('Back')).toBeTruthy()
  expect(screen.getByLabelText('More')).toBeTruthy()
  expect(screen.getByLabelText('Rotate Left')).toBeTruthy()
  expect(screen.getByLabelText('Rotate Right')).toBeTruthy()
})

test('the back button dismisses the viewer', async () => {
  const onDismiss = jest.fn()
  await mount(IMAGE, { onDismiss })
  fireEvent.press(screen.getByLabelText('Back'))
  expect(onDismiss).toHaveBeenCalledTimes(1)
})

test('turning the picture keeps the viewer open', async () => {
  const onDismiss = jest.fn()
  await mount(IMAGE, { onDismiss })
  await act(async () => { fireEvent.press(screen.getByLabelText('Rotate Right')) })
  expect(onDismiss).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Screenshot')).toBeTruthy()
})

const GENERATED: FilePreviewState = {
  ...IMAGE,
  label: 'Generated image',
  generation: {
    revisedPrompt: 'An astronaut tending a bonsai on the Moon',
    generationMs: 14_320,
    params: [{ key: 'provider', value: 'openai' }, { key: 'model', value: 'gpt-image-1' }, { key: 'aspectRatio', value: '9:16' }],
    referenceImagePaths: ['/refs/bonsai.jpg'],
    warnings: ['Prompt was rewritten'],
  },
}

test('a screenshot has no info button', async () => {
  await mount(IMAGE)
  expect(screen.queryByLabelText('Image Info')).toBeNull()
})

test('a generated image opens its facts from the info button; without a host, ids and names stand in', async () => {
  await mount(GENERATED)
  await act(async () => { fireEvent.press(screen.getByLabelText('Image Info')) })
  await screen.findByTestId('image-info-panel')
  expect(screen.getByText('Generated in 14.3s')).toBeTruthy()
  expect(screen.getByText('openai')).toBeTruthy()
  expect(screen.getByText('gpt-image-1')).toBeTruthy()
  expect(screen.getByText('Aspect ratio')).toBeTruthy()
  expect(screen.getByTestId('reference-image-name')).toHaveTextContent('bonsai.jpg')
  expect(screen.getByText('• Prompt was rewritten')).toBeTruthy()
  expect(screen.getByText('An astronaut tending a bonsai on the Moon')).toBeTruthy()
})

test('with a host, provider and model resolve to catalogue names and reference images become thumbs', async () => {
  await mount(GENERATED, { generationPorts: createFakeGenerationPorts() })
  await act(async () => { fireEvent.press(screen.getByLabelText('Image Info')) })
  expect(await screen.findByText('OpenAI')).toBeTruthy()
  expect(screen.getByText('OpenAI Images')).toBeTruthy()
  expect(screen.getByText('GPT Image 1')).toBeTruthy()
  expect(screen.queryByText('gpt-image-1')).toBeNull()
  expect(await screen.findByTestId('reference-image-thumb')).toBeTruthy()
})

test('a reference image the host will not send unasked falls back to its name', async () => {
  await mount(GENERATED, { generationPorts: createFakeGenerationPorts({ images: 'name', providers: [] }) })
  await act(async () => { fireEvent.press(screen.getByLabelText('Image Info')) })
  expect(await screen.findByTestId('reference-image-name')).toHaveTextContent('bonsai.jpg')
  expect(screen.getByText('openai')).toBeTruthy()
})

test('the prompt copies with one tap and the button confirms it', async () => {
  await mount(GENERATED)
  await act(async () => { fireEvent.press(screen.getByLabelText('Image Info')) })
  const copy = await screen.findByLabelText('Copy Prompt')
  await act(async () => { fireEvent.press(copy) })
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('An astronaut tending a bonsai on the Moon')
  expect(await screen.findByLabelText('Prompt copied')).toBeTruthy()
})

test('the info panel is translated', async () => {
  await mount(GENERATED, { locale: 'zh' })
  await act(async () => { fireEvent.press(screen.getByLabelText('图片信息')) })
  await screen.findByTestId('image-info-panel')
  expect(screen.getByText('生成耗时 14.3s')).toBeTruthy()
  expect(screen.getByText('提示词')).toBeTruthy()
})

test('a file body has no rotation controls', async () => {
  await mount(TEXT)
  expect(screen.queryByLabelText('Rotate Left')).toBeNull()
})

test('a mermaid diagram opens as its own page and back dismisses it', async () => {
  const onDismiss = jest.fn()
  await mount({
    kind: 'mermaid',
    name: 'Mermaid',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
  }, { onDismiss })
  expect(screen.getByText('Mermaid')).toBeTruthy()
  expect(screen.queryByTestId('file-preview-type-icon')).toBeNull()
  expect(screen.getByLabelText('Back')).toBeTruthy()
  expect(screen.queryByLabelText('Rotate Left')).toBeNull()
  fireEvent.press(screen.getByLabelText('Back'))
  expect(onDismiss).toHaveBeenCalledTimes(1)
})

test('a mermaid page title follows the shell locale', async () => {
  await mount({
    kind: 'mermaid',
    name: 'Mermaid',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
  }, { locale: 'zh' })
  expect(screen.getByText('Mermaid 图表')).toBeTruthy()
})

test('a mermaid page offers nothing to save or share', async () => {
  const calls: string[] = []
  await mount({
    kind: 'mermaid',
    name: 'Mermaid',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
  }, { ports: createFakeMediaPorts({ onCall: (action) => calls.push(action) }) })
  const save = await runMenuAction('Save to Files')
  expect(save).toBeDisabled()
  expect(screen.getByLabelText('Share')).toBeDisabled()
  expect(calls).toEqual([])
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
  expect(screen.getByTestId('file-preview-type-icon')).toBeTruthy()
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
  expect(screen.queryByText(/not small text/)).toBeNull()
  fireEvent.press(screen.getByText('Download'))
  expect(onStartTransfer).toHaveBeenCalledTimes(1)
})

test('a downloading transfer swaps the button for a progress bar', async () => {
  await mount({ ...RELAY_TRANSFER, phase: 'downloading', receivedBytes: 2_410_056 })
  expect(screen.queryByText('Download')).toBeNull()
  expect(screen.queryByText(/not small text/)).toBeNull()
  expect(screen.getByText('Downloading…')).toBeTruthy()
  expect(screen.getByText('2.3 MB / 4.6 MB')).toBeTruthy()
  expect(screen.getByTestId('file-preview-download-progress')).toBeTruthy()
})

test('a LAN transfer never shows a Download button', async () => {
  await mount({ kind: 'transfer', path: '/workspace/proj/logs/dev.log', name: 'dev.log', size: 2_048, mimeType: 'application/octet-stream', needsConfirm: false, phase: 'downloading' })
  expect(screen.queryByText('Download')).toBeNull()
  expect(screen.queryByText(/not small text/)).toBeNull()
  expect(screen.getByText('Downloading…')).toBeTruthy()
  expect(screen.getByText('0 B / 2.0 KB')).toBeTruthy()
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
  expect(screen.getByLabelText('返回')).toBeTruthy()
  expect(screen.getByLabelText('向左旋转')).toBeTruthy()
  await act(async () => { fireEvent.press(screen.getByLabelText('更多')) })
  expect(await screen.findByText('保存到相册')).toBeTruthy()
  expect(screen.getByText('分享')).toBeTruthy()
})
