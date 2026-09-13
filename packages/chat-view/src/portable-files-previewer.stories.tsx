import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { NativeWidgetPayload, PreviewerFile } from '@superone/shared/generative-ui/native-widgets'
import { installHostBridge } from './bridge'
import { PortableFilesPreviewer } from './PortableFilesPreviewer'

type HostMode = 'lan' | 'relay' | 'slow' | 'unavailable'

interface MockHostWindow extends Window {
  ReactNativeWebView?: { postMessage(message: string): void }
  __applyHost?: (message: unknown) => void
}

/** A 640×400 PNG drawn on the fly so the story needs no fixture file. */
function samplePng(seed: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 400
  const ctx = canvas.getContext('2d')!
  let hue = 0
  for (const ch of seed) hue = (hue * 31 + ch.charCodeAt(0)) % 360
  ctx.fillStyle = `hsl(${hue} 50% 40%)`
  ctx.fillRect(0, 0, 640, 400)
  ctx.fillStyle = 'white'
  ctx.font = '28px system-ui'
  ctx.fillText(seed.split('/').pop() ?? seed, 24, 220)
  return canvas.toDataURL('image/png')
}

const ROOT = '/Users/me/proj'
const TEXTS: Record<string, string> = {
  [`${ROOT}/src/renderer/FilesPreviewer.tsx`]: [
    "import { useState } from 'react'",
    '',
    'export function FilesPreviewer({ files }: { files: PreviewerFile[] }) {',
    '  const [index, setIndex] = useState(0)',
    '  return <Stage file={files[index]} onNext={() => setIndex((i) => i + 1)} />',
    '}',
    ...Array.from({ length: 30 }, (_, i) => `// line ${i + 7}: enough to scroll inside the card`),
  ].join('\n'),
  [`${ROOT}/docs/design/inline-files-previewer.md`]: [
    '# Inline files previewer',
    '',
    'A fixed-height carousel of files with a note under each. [This link](https://example.com) is inert in the card.',
    '',
    '- Swipe between files',
    '- Tap opens the native preview',
    '',
    ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} to give the slide something to scroll through.\n`),
  ].join('\n'),
}

/**
 * Stand in for the React Native host: answers `loadImage`, `loadVideoPoster`
 * and `loadTextFile` the way each transport would, and logs the rest to the
 * console so a tap can be seen to reach `previewFile`.
 */
function MockHost({ mode, children }: { mode: HostMode; children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const host = globalThis as unknown as MockHostWindow
    const uninstall = installHostBridge(() => {})
    host.ReactNativeWebView = {
      postMessage(raw: string) {
        const message = JSON.parse(raw) as { type: string; requestId: string; action: string; payload?: { path?: string; confirmed?: boolean } }
        if (message.type !== 'requestNative') return
        const reply = (body: Record<string, unknown>) =>
          host.__applyHost?.({ type: 'nativeActionResult', requestId: message.requestId, ...body })
        const path = message.payload?.path ?? ''
        const delay = mode === 'slow' ? 2500 : 120
        if (mode === 'unavailable') { reply({ error: `${message.action} is not available on mobile` }); return }
        switch (message.action) {
          case 'loadImage':
            if (mode === 'relay' && !message.payload?.confirmed) { reply({ result: { ok: true, confirmRequired: true, size: 412_000 } }); return }
            setTimeout(() => reply({ result: { ok: true, dataUri: samplePng(path) } }), delay)
            return
          case 'loadVideoPoster':
            setTimeout(() => reply({ result: { ok: true, poster: { dataUri: samplePng(path), width: 640, height: 400, durationMs: 27_051 } } }), delay)
            return
          case 'loadTextFile': {
            const text = TEXTS[path]
            setTimeout(() => reply(text === undefined ? { result: { ok: true, tooLarge: true } } : { result: { ok: true, text } }), delay)
            return
          }
          default:
            console.info('[native]', message.action, message.payload)
            reply({ result: { ok: true } })
        }
      },
    }
    setReady(true)
    return () => {
      uninstall()
      delete host.ReactNativeWebView
    }
  }, [mode])
  return ready ? <>{children}</> : null
}

/** Unique per story load so the WebView's per-path caches do not answer for a different mode. */
const stamp = Date.now()
const files = {
  image: { path: 'shots/drawer-open.png', absolutePath: `${ROOT}/shots/drawer-open-${stamp}.png`, name: 'drawer-open.png', kind: 'image', size: 184_320, note: 'The drawer, open; the active project is already expanded.' },
  video: { path: 'shots/open.mp4', absolutePath: `${ROOT}/shots/open-${stamp}.mp4`, name: 'open.mp4', kind: 'video', size: 5_242_880, note: 'The slide-in, 240ms, no overshoot.' },
  text: { path: 'src/renderer/FilesPreviewer.tsx', absolutePath: `${ROOT}/src/renderer/FilesPreviewer.tsx`, name: 'FilesPreviewer.tsx', kind: 'text', size: 1840, note: 'The card entry point.' },
  markdown: { path: 'docs/design/inline-files-previewer.md', absolutePath: `${ROOT}/docs/design/inline-files-previewer.md`, name: 'inline-files-previewer.md', kind: 'markdown', size: 9120, note: 'Design doc; section 6 is the phone.' },
  largeText: { path: 'logs/session.log', absolutePath: `${ROOT}/logs/session.log`, name: 'session.log', kind: 'text', size: 3_145_728, note: 'Too big for the RPC; opens in the preview page.' },
  pdf: { path: 'reports/q3.pdf', absolutePath: `${ROOT}/reports/q3.pdf`, name: 'q3.pdf', kind: 'pdf', size: 512_000, note: 'Page 3 has the chart.' },
  audio: { path: 'assets/memo.m4a', absolutePath: `${ROOT}/assets/memo.m4a`, name: 'memo.m4a', kind: 'audio', size: 1_048_576 },
  notebook: { path: 'notebooks/analysis.ipynb', absolutePath: `${ROOT}/notebooks/analysis.ipynb`, name: 'analysis.ipynb', kind: 'notebook', size: 4096 },
  missing: { path: 'reports/q3-summary.pdf', absolutePath: `${ROOT}/reports/q3-summary.pdf`, name: 'q3-summary.pdf', kind: 'missing', note: 'Not generated yet.' },
  binary: { path: 'build/app.bin', absolutePath: `${ROOT}/build/app.bin`, name: 'app.bin', kind: 'unpreviewable', reason: 'binary', size: 12_582_912 },
  longNote: { path: 'shots/drawer-open.png', absolutePath: `${ROOT}/shots/drawer-open-${stamp}.png`, name: 'drawer-open.png', kind: 'image', size: 184_320, note: 'A very long note that keeps going well past two lines to show the clamp in the footer. It repeats itself to make sure the ellipsis appears and the full text is still available in the fullscreen preview, which is what the design asks for.' },
} satisfies Record<string, PreviewerFile>

function payload(list: PreviewerFile[]): NativeWidgetPayload {
  return { kind: 'native', nativeType: 'files-previewer', title: 'evidence', root: ROOT, files: list }
}

type PreviewerStoryProps = React.ComponentProps<typeof PortableFilesPreviewer> & { mode: HostMode }

function PreviewerStory({ mode: _mode, ...props }: PreviewerStoryProps) {
  return <PortableFilesPreviewer {...props} />
}

const meta = {
  title: 'Chat/SuperOne/Files previewer',
  component: PreviewerStory,
  parameters: { layout: 'padded' },
  argTypes: { mode: { control: 'radio', options: ['lan', 'relay', 'slow', 'unavailable'] } },
  decorators: [(Story, context) => (
    <MockHost key={String(context.args.mode)} mode={context.args.mode}>
      <div className="w-[390px] text-sm"><Story /></div>
    </MockHost>
  )],
  args: { mode: 'lan', payload: payload([files.image, files.text, files.markdown, files.video, files.pdf, files.missing, files.largeText]) },
} satisfies Meta<typeof PreviewerStory>

export default meta
type Story = StoryObj<typeof meta>

/** Seven kinds; swipe the stage or tap a dot. A tap on the stage logs `previewFile` to the console. */
export const Default: Story = {}

export const Image: Story = { args: { payload: payload([files.image]) } }
export const Relay: Story = {
  name: 'Relay · the image asks before staging',
  args: { mode: 'relay', payload: payload([files.image, files.text]) },
}
export const SourceCode: Story = { args: { payload: payload([files.text]) } }
export const Markdown: Story = { args: { payload: payload([files.markdown]) } }
export const Video: Story = { name: 'Video · poster with a play badge', args: { payload: payload([files.video]) } }
export const Chips: Story = {
  name: 'Chip stages · pdf, audio, notebook, large text, binary',
  args: { payload: payload([files.pdf, files.audio, files.notebook, files.largeText, files.binary]) },
}
export const Missing: Story = { args: { payload: payload([files.missing]) } }
export const Slow: Story = { name: 'Slow host · spinners until the bytes land', args: { mode: 'slow' } }
export const Unavailable: Story = {
  name: 'Host cannot answer · every stage falls back to a chip',
  args: { mode: 'unavailable', payload: payload([files.image, files.text, files.video]) },
}
export const LongNote: Story = { args: { payload: payload([files.longNote, files.text]) } }
export const FortyFiles: Story = {
  args: {
    payload: payload(Array.from({ length: 40 }, (_, i) => ({ ...files.text, path: `src/module-${i + 1}/index.ts`, name: 'index.ts', note: `Module ${i + 1}` }))),
  },
}
