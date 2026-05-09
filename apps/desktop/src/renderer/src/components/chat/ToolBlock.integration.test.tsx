/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const stubs: Record<string, () => null> = {}
  for (const key of Object.keys(actual)) stubs[key] = () => null
  return stubs
})

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: { toolRenderers: Record<string, never>; activeProject: string | null }) => unknown) =>
    selector({ toolRenderers: {}, activeProject: '/proj' }),
  useActiveSession: (selector: (state: { cwd: string; homedir: string }) => unknown) =>
    selector({ cwd: '/proj', homedir: '/Users/test' }),
  useBashOutput: () => ({ chunks: [], completed: true }),
}))

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: { mcpMeta: Record<string, never>; mcpLibrary: never[] }) => unknown) =>
    selector({ mcpMeta: {}, mcpLibrary: [] }),
}))

vi.mock('@/stores/source-control', () => ({
  useSourceControlStore: () => ({}),
}))

vi.mock('@/stores/miniapp', () => ({
  useMiniAppStore: (selector: (state: { apps: never[] }) => unknown) => selector({ apps: [] }),
}))

vi.mock('@/components/activity/activity-panel-api', () => ({
  openFileTab: vi.fn(),
}))

vi.mock('@/components/ui/FileIcon', () => ({
  FileIcon: () => null,
}))

vi.mock('@/components/miniapp/MiniAppIcon', () => ({
  MiniAppIcon: () => null,
}))

vi.mock('@/lib/stall-utils', () => ({
  useStallLevel: () => 0,
  getStallColor: () => '',
}))

vi.mock('@/lib/ansi', () => ({
  AnsiText: ({ text }: { text: string }) => <span>{text}</span>,
}))

vi.mock('@/lib/file-link', () => ({
  parseFileLinkTarget: () => null,
}))

vi.mock('@/lib/diff-utils', () => ({
  inferLanguage: () => 'ts',
  useHighlightedTokens: () => null,
  useIncrementalHighlightedLines: () => null,
  DiffView: () => <div>diff-view</div>,
  splitContentLines: (text: string) => text.split('\n'),
  buildUnifiedFileChangeDiffLines: () => [],
}))

vi.mock('./ToolIcon', () => ({
  ToolIcon: () => <span>icon</span>,
}))

vi.mock('./CodeBlock', () => ({
  HighlightedCodeBlock: ({ text }: { text: string }) => <pre>{text}</pre>,
}))

vi.mock('./tool-display', () => ({
  getToolDisplay: () => ({ icon: 'file-edit', summary: 'foo.ts' }),
  getToolVerb: (name: string) => name,
  parseToolInput: (input: string) => JSON.parse(input),
  extractPartialToolInput: () => ({}),
  parseMcpToolName: () => null,
  formatReadMeta: () => '',
}))

vi.mock('./chat-shared', () => ({
  codePlugin: {
    supportsLanguage: () => false,
    getThemes: () => ({}),
    highlight: () => null,
  },
}))

vi.mock('./tool-block-utils', () => ({
  countUnifiedDiffDelta: () => null,
  countPrefixedDiffDelta: () => null,
  computeLineDelta: () => null,
  computeStreamingEditDelta: () => null,
  tryPrettifyJson: () => null,
  parseQAPairs: () => [],
  extractToolError: (text: string) => text,
}))

vi.mock('./WidgetBlock', () => ({
  WidgetBlock: () => null,
}))

vi.mock('./CanvasEditDiff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./CanvasEditDiff')>()
  return {
    ...actual,
    CanvasEditDiff: () => <div>canvas-edit-diff</div>,
  }
})

vi.mock('./InChatMiniAppBlock', () => ({
  InChatMiniAppBlock: () => null,
}))

vi.mock('./ToolRendererFrame', () => ({
  ToolRendererFrame: () => null,
}))

Object.defineProperty(window, 'agent', {
  value: {
    findLineNumber: vi.fn().mockResolvedValue(null),
  },
  configurable: true,
})

Object.defineProperty(window, 'app', {
  value: {
    trace: vi.fn(),
    showInFolder: vi.fn(),
  },
  configurable: true,
})

const { ToolBlock } = await import('./ToolBlock')

describe('ToolBlock diff content lifecycle', () => {
  it('unmounts the streaming edit preview after collapse', async () => {
    render(
      <ToolBlock
        toolName="Edit"
        input={JSON.stringify({
          file_path: '/proj/foo.ts',
          old_string: 'const a = 1\n',
          new_string: 'const a = 2\n',
        })}
        status="streaming"
      />,
    )

    await waitFor(() => expect(screen.queryByText('canvas-edit-diff')).not.toBeNull())

    fireEvent.click(screen.getByText(/^Edit/))
    expect(screen.queryByText('canvas-edit-diff')).toBeNull()

    fireEvent.click(screen.getByText(/^Edit/))
    await waitFor(() => expect(screen.queryByText('canvas-edit-diff')).not.toBeNull())
  })
})

describe('ToolBlock hidden tools', () => {
  it.each(['TodoWrite', 'TaskCreate', 'TaskUpdate'])('renders nothing for %s', (toolName) => {
    const { container } = render(
      <ToolBlock toolName={toolName} input={JSON.stringify({})} status="complete" />,
    )
    expect(container.firstChild).toBeNull()
  })
})

describe('ToolBlock error auto-collapse', () => {
  it('collapses an expanded edit tool when the result arrives with isError=true', async () => {
    const { rerender } = render(
      <ToolBlock
        toolName="Edit"
        input={JSON.stringify({
          file_path: '/proj/foo.ts',
          old_string: 'const a = 1\n',
          new_string: 'const a = 2\n',
        })}
        status="streaming"
      />,
    )

    await waitFor(() => expect(screen.queryByText('canvas-edit-diff')).not.toBeNull())

    rerender(
      <ToolBlock
        toolName="Edit"
        input={JSON.stringify({
          file_path: '/proj/foo.ts',
          old_string: 'const a = 1\n',
          new_string: 'const a = 2\n',
        })}
        status="complete"
        result="Patch failed: file changed on disk"
        isError
      />,
    )

    await waitFor(() => {
      expect(screen.queryByText('Patch failed: file changed on disk')).toBeNull()
    })

    fireEvent.click(screen.getByText(/^Edit/))
    await waitFor(() => {
      expect(screen.queryByText('Patch failed: file changed on disk')).not.toBeNull()
    })
  })
})
