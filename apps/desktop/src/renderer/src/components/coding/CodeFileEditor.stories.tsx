import { useEffect, useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor } from 'storybook/test'
import { createTwoFilesPatch } from 'diff'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { CodeCommentNoteHost } from '@/components/chat/CodeCommentNoteHost'
import { useAppStore } from '@/stores/app'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { CodeFileEditor } from './CodeFileEditor'

const ROOT = '/storybook'

const BASE_TS = [
  "import { createServer } from 'node:http'",
  "import { parseUrl } from './router'",
  '',
  'export interface ServerOptions {',
  '  port: number',
  '  host?: string',
  '}',
  '',
  'export function startServer(options: ServerOptions) {',
  "  const host = options.host ?? '127.0.0.1'",
  '  const legacyTimeout = 5000',
  '  const server = createServer((req, res) => {',
  "    const route = parseUrl(req.url ?? '/')",
  '    res.writeHead(200, { "content-type": "application/json" })',
  '    res.end(JSON.stringify({ ok: true, route }))',
  '  })',
  '  server.listen(options.port, host)',
  '  return server',
  '}',
  '',
].join('\n')

const MODIFIED_TS = [
  "import { createServer } from 'node:http'",
  "import { parseUrl } from './router'",
  '',
  'export interface ServerOptions {',
  '  port: number',
  '  host?: string',
  '  keepAliveTimeoutMs?: number',
  '}',
  '',
  'export function startServer(options: ServerOptions) {',
  "  const host = options.host ?? '0.0.0.0'",
  '  const server = createServer((req, res) => {',
  "    const route = parseUrl(req.url ?? '/')",
  '    res.writeHead(200, { "content-type": "application/json; charset=utf-8" })',
  '    res.end(JSON.stringify({ ok: true, route, ts: Date.now() }))',
  '  })',
  '  if (options.keepAliveTimeoutMs) {',
  '    server.keepAliveTimeout = options.keepAliveTimeoutMs',
  '  }',
  '  server.listen(options.port, host)',
  '  return server',
  '}',
  '',
].join('\n')

const LONG_BASE = Array.from(
  { length: 320 },
  (_, i) => `export const metric_${String(i + 1).padStart(3, '0')} = { id: ${i + 1}, status: 'stable', latencyMs: ${(i * 7) % 95} }`,
).join('\n') + '\n'

const LONG_CURRENT = Array.from({ length: 320 }, (_, i) => {
  if (i === 4) {
    return `export const metric_005 = { id: 5, status: 'degraded', latencyMs: 240, retried: true }`
  }
  if (i === 12) return null
  if (i === 28) {
    return [
      `export const metric_029 = { id: 29, status: 'stable', latencyMs: 12 }`,
      `export const metric_029_extra = { id: 2901, status: 'canary', latencyMs: 8 }`,
    ].join('\n')
  }
  return `export const metric_${String(i + 1).padStart(3, '0')} = { id: ${i + 1}, status: 'stable', latencyMs: ${(i * 7) % 95} }`
})
  .filter((line): line is string => line !== null)
  .join('\n') + '\n'

interface InteractiveHarnessProps {
  filePath: string
  baseContent: string
  initialContent: string
  width?: number
  height?: number
  transparentBg?: boolean
  vimMode?: boolean
}

function InteractiveHarness({
  filePath,
  baseContent,
  initialContent,
  width = 760,
  height = 460,
  transparentBg = false,
  vimMode = false,
}: InteractiveHarnessProps) {
  useAppStore.setState({
    currentFolder: ROOT,
    liquidGlass: false,
    editorVimMode: vimMode,
    editorRelativeLineNumbers: false,
  })
  const [disk, setDisk] = useState(initialContent)
  const [draft, setDraft] = useState(initialContent)

  mockIpc('app', 'saveFile', async (...args: unknown[]) => {
    const nextContent = String(args[2] ?? '')
    setDisk(nextContent)
    setDraft(nextContent)
    return { ok: true }
  })
  mockIpc('app', 'setUnsavedEditorBuffer', async () => {})

  const gitDiff = useMemo(
    () => (baseContent === disk ? '' : createTwoFilesPatch(`a/${filePath}`, `b/${filePath}`, baseContent, disk)),
    [baseContent, disk, filePath],
  )

  return (
    <div
      className={transparentBg ? 'bg-transparent' : 'border border-border bg-background'}
      style={{ width, maxWidth: '100%', height }}
    >
      <CodeFileEditor
        content={draft}
        diskContent={disk}
        gitDiff={gitDiff}
        filePath={filePath}
        fileRoot={ROOT}
        onContentChange={setDraft}
        onSaved={(savedText) => {
          setDisk(savedText)
          setDraft(savedText)
        }}
      />
    </div>
  )
}

const meta = {
  title: 'Coding/CodeFileEditor',
  component: CodeFileEditor,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CodeFileEditor>

export default meta
type Story = StoryObj<typeof CodeFileEditor>

export const CleanFile: Story = {
  render: () => (
    <InteractiveHarness
      filePath="src/server.ts"
      baseContent={BASE_TS}
      initialContent={BASE_TS}
    />
  ),
}

export const WithGitDiff: Story = {
  render: () => (
    <InteractiveHarness
      filePath="src/server.ts"
      baseContent={BASE_TS}
      initialContent={MODIFIED_TS}
    />
  ),
}

export const EmptyFile: Story = {
  render: () => (
    <InteractiveHarness
      filePath="src/empty.ts"
      baseContent=""
      initialContent=""
      height={280}
    />
  ),
}

export const LongContent: Story = {
  render: () => (
    <InteractiveHarness
      filePath="src/metrics-catalog.ts"
      baseContent={LONG_BASE}
      initialContent={LONG_CURRENT}
      height={520}
    />
  ),
}

export const NarrowLayout: Story = {
  render: () => (
    <InteractiveHarness
      filePath="src/server.ts"
      baseContent={BASE_TS}
      initialContent={MODIFIED_TS}
      width={340}
      height={420}
    />
  ),
}

export const LiquidGlassDark: Story = {
  render: () => (
    <div className="liquid-glass dark rounded-xl bg-[linear-gradient(135deg,#1d2d44,#3e2c41)] p-5">
      <div className="overflow-hidden rounded-lg border border-border bg-transparent">
        <InteractiveHarness
          filePath="src/metrics-catalog.ts"
          baseContent={LONG_BASE}
          initialContent={LONG_CURRENT}
          height={440}
          transparentBg
        />
      </div>
    </div>
  ),
}

export const VimMode: Story = {
  render: () => (
    <InteractiveHarness
      filePath="src/server.ts"
      baseContent={BASE_TS}
      initialContent={MODIFIED_TS}
      vimMode
    />
  ),
}

const HOST_QUOTE = [
  '/storybook/src/server.ts:L11:D',
  "-  const host = options.host ?? '127.0.0.1'",
  "+  const host = options.host ?? '0.0.0.0'",
].join('\n')

/** A code comment shares the conversation's numbering and paints a stroke plus a pin on the line. */
function CommentedFile() {
  useEffect(() => {
    const previous = useChatStore.getState()
    useChatStore.setState({
      activeProject: ROOT,
      projectSessions: {
        ...previous.projectSessions,
        [ROOT]: {
          ...createDefaultProjectState(),
          _activeSessionId: 'story',
          _sessions: {
            story: {
              ...createDefaultPerSessionState(),
              replyComments: [
                { id: 'c-chat', messageId: 'm1', anchorText: 'a passage', quote: 'a passage', text: 'from chat' },
                { id: 'c-code', messageId: null, anchorText: HOST_QUOTE, quote: HOST_QUOTE, text: 'Bind every interface', surface: 'code' },
              ],
            },
          },
        },
      },
    })
    return () => { useChatStore.setState(previous) }
  }, [])
  return (
    <>
      <CodeCommentNoteHost />
      <InteractiveHarness filePath="src/server.ts" baseContent={BASE_TS} initialContent={MODIFIED_TS} />
    </>
  )
}

export const WithComments: Story = {
  render: () => <CommentedFile />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const pin = canvasElement.querySelector('[data-testid="code-comment-layer"] button')
      expect(pin?.textContent).toBe('2')
    })
  },
}
