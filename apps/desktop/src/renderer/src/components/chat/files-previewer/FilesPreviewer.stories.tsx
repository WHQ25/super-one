import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo, useState } from 'react'
import type { NativeWidgetPayload, PreviewerFile } from '@superone/shared/generative-ui/native-widgets'
import { mockIpc } from '../../../../../../.storybook/mock-ipc'
import { FilesPreviewer } from './FilesPreviewer'
import boxUrl from '../../coding/__fixtures__/Box.glb?url'

/**
 * Every state the card can show, with `window.app` answered from fixtures.
 * Media use `data:` URLs so nothing needs the media server; text-class kinds
 * are served by the `readProjectFile` mock keyed on the absolute path.
 */
const ROOT = '/Users/dev/projects/super-one'

const diagramSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400">
  <rect width="640" height="400" fill="#f4f1ea"/>
  <rect x="60" y="60" width="200" height="80" rx="8" fill="#e8e4f8" stroke="#534AB7"/>
  <text x="160" y="108" text-anchor="middle" font-family="system-ui" font-size="20" fill="#3C3489">Renderer</text>
  <rect x="380" y="60" width="200" height="80" rx="8" fill="#e8e4f8" stroke="#534AB7"/>
  <text x="480" y="108" text-anchor="middle" font-family="system-ui" font-size="20" fill="#3C3489">Main</text>
  <rect x="220" y="260" width="200" height="80" rx="8" fill="#e1f5ee" stroke="#1D9E75"/>
  <text x="320" y="308" text-anchor="middle" font-family="system-ui" font-size="20" fill="#085041">MCP server</text>
  <path d="M260 100h120M200 140l80 120M440 140l-80 120" stroke="#888780" stroke-width="2" fill="none"/>
</svg>`
const DIAGRAM_URL = `data:image/svg+xml;utf8,${encodeURIComponent(diagramSvg)}`

const TEXT_FILES: Record<string, { content: string; language: string }> = {
  [`${ROOT}/src/renderer/components/chat/FilesPreviewer.tsx`]: {
    language: 'typescript',
    content: [
      "import { useState } from 'react'",
      '',
      'export function FilesPreviewer({ files }: { files: PreviewerFile[] }) {',
      '  const [index, setIndex] = useState(0)',
      '  const file = files[index]',
      '  return (',
      '    <PreviewerFrame file={file}',
      '      onPrev={() => setIndex((i) => i - 1)}',
      '      onNext={() => setIndex((i) => i + 1)} />',
      '  )',
      '}',
      ...Array.from({ length: 30 }, (_, i) => `// line ${i + 12}: enough lines to scroll inside the card`),
    ].join('\n'),
  },
  [`${ROOT}/docs/design/inline-files-previewer.md`]: {
    language: 'markdown',
    content: [
      '# Inline files previewer',
      '',
      'A fixed-height carousel of files with a note under each. [This link](https://example.com) is inert in the card.',
      '',
      '- Arrows on desktop, swipe on the phone',
      '- Tap opens the real viewer',
      '',
      '```ts',
      "const kind = fileKindFromName('a.png')",
      '```',
      '',
      ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} to give the slide something to scroll through.\n`),
    ].join('\n'),
  },
  [`${ROOT}/notebooks/analysis.ipynb`]: {
    language: 'json',
    content: JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells: [
        { cell_type: 'code', source: ['df = pd.read_csv("sessions.csv")\n', 'df.groupby("harness").size()'], outputs: [{ output_type: 'stream', name: 'stdout', text: ['claude    1284\n', 'codex      612\n'] }], execution_count: 1, metadata: {} },
        { cell_type: 'markdown', source: ['## Sessions per harness'], metadata: {} },
      ],
    }),
  },
}

const files = {
  image: { path: 'docs/design/architecture.svg', absolutePath: DIAGRAM_URL, name: 'architecture.svg', kind: 'image', size: 2048, note: 'Overall architecture: renderer, main and the MCP server; arrows are IPC direction.' },
  text: { path: 'src/renderer/components/chat/FilesPreviewer.tsx', absolutePath: `${ROOT}/src/renderer/components/chat/FilesPreviewer.tsx`, name: 'FilesPreviewer.tsx', kind: 'text', size: 1840, note: 'The new block entry point.' },
  markdown: { path: 'docs/design/inline-files-previewer.md', absolutePath: `${ROOT}/docs/design/inline-files-previewer.md`, name: 'inline-files-previewer.md', kind: 'markdown', size: 9120, note: 'Design doc; section 2 lists the supported kinds.' },
  notebook: { path: 'notebooks/analysis.ipynb', absolutePath: `${ROOT}/notebooks/analysis.ipynb`, name: 'analysis.ipynb', kind: 'notebook', size: 4096, note: 'The last cell plots sessions per harness.' },
  video: { path: 'demo/onboarding.mp4', absolutePath: 'data:video/mp4;base64,AAAA', name: 'onboarding.mp4', kind: 'video', size: 5_242_880, note: 'Screen recording; the first ten seconds show the swipe on the phone.' },
  audio: { path: 'assets/voice-memo.m4a', absolutePath: 'data:audio/mp4;base64,AAAA', name: 'voice-memo.m4a', kind: 'audio', size: 1_048_576, note: 'Product meeting memo, about two minutes.' },
  model: { path: 'assets/Box.glb', absolutePath: boxUrl, name: 'Box.glb', kind: 'model', size: 1664, note: 'Khronos Box sample; click for orbit controls.' },
  missing: { path: 'reports/q3-summary.pdf', absolutePath: `${ROOT}/reports/q3-summary.pdf`, name: 'q3-summary.pdf', kind: 'missing', note: 'Not generated yet — retry once the report job finishes.' },
  binary: { path: 'build/app.bin', absolutePath: `${ROOT}/build/app.bin`, name: 'app.bin', kind: 'unpreviewable', reason: 'binary', size: 12_582_912, note: 'Release binary.' },
  tooLarge: { path: 'logs/session.log', absolutePath: `${ROOT}/logs/session.log`, name: 'session.log', kind: 'unpreviewable', reason: 'too_large', size: 104_857_600 },
  outside: { path: '/etc/hosts', absolutePath: '/etc/hosts', name: 'hosts', kind: 'unpreviewable', reason: 'outside_readable_roots', size: 220 },
  longNote: { path: 'docs/design/architecture.svg', absolutePath: DIAGRAM_URL, name: 'architecture.svg', kind: 'image', size: 2048, note: 'A very long note that keeps going well past two lines to show the clamp in the card footer. It repeats itself to make sure the ellipsis appears and the full text is still available on hover through the title attribute, which is what the design asks for.' },
} satisfies Record<string, PreviewerFile>

function payload(list: PreviewerFile[]): NativeWidgetPayload {
  return { kind: 'native', nativeType: 'files-previewer', title: 'changed_files', root: ROOT, files: list }
}

/**
 * Registered during render, not in an effect: the card's loader effect runs
 * before a parent's effect would, and would hit the unmocked proxy first.
 */
function Fixtures({ children, delayMs = 0 }: { children: React.ReactNode; delayMs?: number }) {
  useMemo(() => {
    mockIpc('app', 'readProjectFile', async (_root: unknown, path: unknown) => {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      const hit = TEXT_FILES[String(path)]
      return hit ? { path, ...hit } : { path, content: '', language: 'text', error: 'ENOENT' }
    })
    mockIpc('app', 'statPreviewFile', async (_root: unknown, path: unknown) => ({
      path, absolutePath: `${ROOT}/${path}`, name: String(path).split('/').pop(), kind: 'missing',
    }))
    mockIpc('app', 'getGitDiffFile', async () => ({ path: '', diff: '' }))
    mockIpc('app', 'getMediaServerPort', async () => 0)
  }, [delayMs])
  return <>{children}</>
}

const meta = {
  title: 'Chat/FilesPreviewer',
  component: FilesPreviewer,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <Fixtures><div style={{ maxWidth: 720, containerType: 'inline-size' }}><Story /></div></Fixtures>],
  args: { payload: payload([files.image, files.text, files.markdown, files.notebook, files.video, files.audio, files.missing]) },
} satisfies Meta<typeof FilesPreviewer>
export default meta
type Story = StoryObj<typeof meta>

/** Seven kinds; arrows, dots, keyboard and the stage click all live. */
export const Default: Story = {}

export const Image: Story = { args: { payload: payload([files.image]) } }
export const SourceCode: Story = { args: { payload: payload([files.text]) } }
export const Markdown: Story = { args: { payload: payload([files.markdown]) } }
export const Notebook: Story = { args: { payload: payload([files.notebook]) } }
/** The fixture is not a real clip, so this is also the decode-error state for media. */
export const VideoUndecodable: Story = { args: { payload: payload([files.video]) } }
export const Audio: Story = { args: { payload: payload([files.audio]) } }
function ModelStory() {
  const [dataUrl, setDataUrl] = useState('')
  useEffect(() => {
    let cancelled = false
    void fetch(boxUrl).then((response) => response.arrayBuffer()).then((bytes) => {
      if (cancelled) return
      const binary = Array.from(new Uint8Array(bytes), (byte) => String.fromCharCode(byte)).join('')
      setDataUrl(`data:model/gltf-binary;base64,${btoa(binary)}`)
    })
    return () => { cancelled = true }
  }, [])
  return dataUrl ? <FilesPreviewer payload={payload([{ ...files.model, absolutePath: dataUrl }])} /> : null
}
export const Model: Story = { render: () => <ModelStory /> }

export const Missing: Story = { args: { payload: payload([files.missing]) } }
export const UnpreviewableBinary: Story = { args: { payload: payload([files.binary]) } }
export const UnpreviewableTooLarge: Story = { args: { payload: payload([files.tooLarge]) } }
export const UnpreviewableOutsideRoots: Story = { args: { payload: payload([files.outside]) } }

/** Text slides read over IPC; a slow answer shows the skeleton. */
export const Loading: Story = {
  args: { payload: payload([files.text, files.markdown]) },
  decorators: [(Story) => <Fixtures delayMs={60_000}><Story /></Fixtures>],
}

/**
 * A remote-node session. Every path the agent wrote is a node path — a
 * screenshot in the session sync zone, a source file in the node project — and
 * the card never touches a desktop file:// URL: text and media alike go through
 * `readProjectFile(root, absolutePath)`, which the main process resolves via
 * `resolveSessionFile` (session-sync-zone.md §4.2). Visually identical to a
 * local card, which is the point.
 */
const NODE_ROOT = 'remote:conn-1:/home/node/proj'
const NODE_ZONE = '/home/node/.superone/node/sync/s1'
const nodeFiles = {
  shot: { path: `${NODE_ZONE}/browser/shot.png`, absolutePath: `${NODE_ZONE}/browser/shot.png`, name: 'shot.png', kind: 'image', size: 24_576, note: 'Taken on the desktop, pushed to the node, read back through the mirror.' },
  report: { path: `${NODE_ZONE}/agent/report.md`, absolutePath: `${NODE_ZONE}/agent/report.md`, name: 'report.md', kind: 'markdown', size: 512, note: 'Written by the agent into $SUPERONE_SESSION_DIR/agent.' },
  source: { path: 'src/index.ts', absolutePath: '/home/node/proj/src/index.ts', name: 'index.ts', kind: 'text', size: 840, note: 'A file in the node project, stat via workspace.listDir.' },
} satisfies Record<string, PreviewerFile>

function RemoteFixtures({ children }: { children: React.ReactNode }) {
  useMemo(() => {
    mockIpc('app', 'readProjectFile', async (_root: unknown, path: unknown) => {
      const key = String(path)
      if (key.endsWith('.png')) return { path, content: DIAGRAM_URL, language: 'image' }
      if (key.endsWith('.md')) return { path, content: '# Run report\n\nAll three breakpoints hold.\n', language: 'markdown' }
      return { path, content: 'export const answer = 42\n', language: 'typescript' }
    })
    mockIpc('app', 'getMediaServerPort', async () => 0)
  }, [])
  return <>{children}</>
}

export const RemoteNodeSession: Story = {
  args: { payload: { kind: 'native', nativeType: 'files-previewer', title: 'evidence', root: NODE_ROOT, files: [nodeFiles.shot, nodeFiles.report, nodeFiles.source] } },
  decorators: [(Story) => <RemoteFixtures><div style={{ maxWidth: 720, containerType: 'inline-size' }}><Story /></div></RemoteFixtures>],
}

export const LongNote: Story = { args: { payload: payload([files.longNote, files.text]) } }

/** Below 512px the card drops to 480px and the arrows stay visible. */
export const NarrowPane: Story = {
  decorators: [(Story) => <div style={{ width: 360, containerType: 'inline-size' }}><Story /></div>],
}

export const FortyFiles: Story = {
  args: {
    payload: payload(Array.from({ length: 40 }, (_, i) => ({
      ...files.text,
      path: `src/module-${i + 1}/index.ts`,
      name: `index.ts`,
      note: `Module ${i + 1}`,
    }))),
  },
}
