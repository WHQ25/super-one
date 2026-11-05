/** @vitest-environment jsdom */

import { act, fireEvent, render, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { withCodexContent } from '@superone/shared/codex-content'
import { projectWindowMessage } from '@superone/runtime/stream/delivery/window-projection'
import { DetailViews } from '@superone/runtime/stream/delivery/projection'
import { createDetailClient, type DetailTransport } from '@superone/chat-core'
import { DetailScopeProvider } from '@superone/chat-view/detail-scope'
import { turnDisplayContent } from '@superone/chat-view/presenters/turn-content'
import { TurnBlockPresenter, type TurnBodyPresenterParts, type TurnBodyPresenterRuntime } from './presenters/TurnBody'

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: unknown) => unknown) => selector({ toolRenderers: {}, activeProject: '/proj', projectSessions: {} }),
  useActiveSession: (selector: (state: unknown) => unknown) => selector({ cwd: '/proj', homedir: '/Users/test', _streamingToolInputPreviews: {} }),
  useBashOutput: () => ({ chunks: [], completed: true }),
}))
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({ mcpMeta: {}, mcpLibrary: [] }),
}))
vi.mock('@/stores/miniapp', () => ({
  useMiniAppStore: (selector: (state: unknown) => unknown) => selector({ apps: [] }),
}))
// Assert the counter values without the rolling digit animation's hidden 0–9 strip.
vi.mock('./RollingNumber', () => ({ RollingNumber: ({ value }: { value: number }) => <>{value}</> }))
vi.mock('@/components/activity/activity-panel-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), openFileTab: vi.fn(),
}))

// JSDOM has no canvas text metrics; keep the production diff renderer.
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
  font: '12px monospace', measureText: (text: string) => ({ width: text.length * 7 }),
} as unknown as CanvasRenderingContext2D)
// Give the virtualized diff a viewport; JSDOM otherwise measures it as 0 × 0.
vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300)
vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(720)

const { ToolBlock } = await import('./ToolBlock')
const Empty = () => null
const parts: TurnBodyPresenterParts = {
  Tool: ToolBlock, Text: Empty, Insight: Empty, Document: Empty, Reasoning: Empty,
  Subagent: Empty, Workflow: Empty, Plan: Empty, ToolGroup: Empty, AppToolGroup: Empty,
  TurnDetail: Empty, Fold: Empty,
}
const runtime: TurnBodyPresenterRuntime = {
  isBackgroundTool: () => false, isPinnedSegment: () => false, isHiddenTool: () => false,
  summarizeProcess: () => ({ toolCalls: 0, filesChanged: 0, added: 0, removed: 0 }),
}

function message(content: ContentBlock[]): ChatMessage {
  return { id: 'turn', role: 'assistant', status: 'complete', createdAt: '', providerId: 'codex', content }
}

function renderRemote(source: ChatMessage) {
  const projected = projectWindowMessage(source)
  const views = new DetailViews()
  views.open('session')
  const subscribe = vi.fn<DetailTransport['subscribe']>(async (target, subscriptionId) => views.subscribe('session', subscriptionId, target.detailRef, source))
  const client = createDetailClient({ subscribe, unsubscribe: () => {} }, { newId: () => crypto.randomUUID() })
  const content = turnDisplayContent(withCodexContent(projected))
  const view = render(<DetailScopeProvider scope={{ client, environmentId: 'node', sessionId: 'session' }}>
    {content.map((block, index) => <TurnBlockPresenter key={index} block={block} index={index}
      isStreaming={false} parts={parts} runtime={runtime} />)}
  </DetailScopeProvider>)
  return { ...view, subscribe, projected }
}

describe('desktop remote file edit headers', () => {
  it('shows each Codex file change count before fetching its diff and opens the selected file', async () => {
    const source = message([])
    source.metadata = { codex: { threadId: 'thread', usage: null, items: [{
      id: 'patch', type: 'file_change', status: 'completed', changes: [
        { path: '/proj/a.ts', kind: 'update', diff: '@@ -1 +1,2 @@\n-before\n+after\n+extra' },
        { path: '/proj/b.ts', kind: 'delete', diff: 'one\ntwo\nthree' },
      ],
    }] } }
    const { container, projected, subscribe } = renderRemote(source)
    expect(JSON.stringify(projected)).not.toContain('before')
    const rows = container.querySelectorAll('.tool-node')
    expect(within(rows[0] as HTMLElement).getByText('+2')).toBeVisible()
    expect(within(rows[0] as HTMLElement).getByText('-1')).toBeVisible()
    expect(within(rows[1] as HTMLElement).getByText('-3')).toBeVisible()
    expect(subscribe).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(rows[1].firstElementChild!) })
    await waitFor(() => expect(rows[1]).toHaveTextContent('three'))
    expect(rows[1]).not.toHaveTextContent('after')
    expect(within(rows[1] as HTMLElement).getByText('-3')).toBeVisible()
  })

  it.each([
    ['Claude Write', 'Write', { file_path: '/proj/a.ts', content: 'one\ntwo\nthree' }, 3, 0],
    ['Claude / ACP Edit', 'Edit', { file_path: '/proj/a.ts', old_string: 'before', new_string: 'after\nextra' }, 2, 1],
    ['Grok write_file', 'write_file', { target_file: '/proj/a.ts', contents: 'one\ntwo' }, 2, 0],
    ['Cursor Edit', 'Edit', { file_path: '/proj/a.ts', diffString: '@@ -1 +1,2 @@\n-before\n+after\n+extra', linesAdded: 2, linesRemoved: 1 }, 2, 1],
    ['OpenCode write', 'write', { filePath: '/proj/a.ts', content: 'one\ntwo' }, 2, 0],
  ] as const)('shows %s counts from the projected transcript', (_label, toolName, input, added, removed) => {
    const { container, subscribe } = renderRemote(message([
      { type: 'tool_use', toolUseId: 'edit', toolName, input: JSON.stringify(input), status: 'complete' },
    ]))
    expect(within(container).getByText(`+${added}`)).toBeVisible()
    if (removed) expect(within(container).getByText(`-${removed}`)).toBeVisible()
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('preserves supplied workspace edit counts used by DeepSeek rows', () => {
    const { container, subscribe } = renderRemote(message([{
      type: 'tool_use', toolName: 'Edit', toolUseId: 'workspace-edit', status: 'complete',
      input: '{"file_path":"/proj/a.ts"}', toolFilePath: '/proj/a.ts', toolLineDelta: { added: 4, removed: 2 },
    }]))
    expect(within(container).getByText('+4')).toBeVisible()
    expect(within(container).getByText('-2')).toBeVisible()
    expect(subscribe).not.toHaveBeenCalled()
  })

  it.each([
    { result: '[denied] User denied permission', isError: true },
    { result: 'EACCES', isError: true },
  ])('does not claim line changes for an unsuccessful edit: $result', (outcome) => {
    const { container } = render(<ToolBlock toolName="Edit" toolUseId="failed" input='{"file_path":"/proj/a.ts"}'
      status="complete" toolLineDelta={{ added: 2, removed: 1 }} {...outcome} />)
    expect(within(container).queryByText('+2')).toBeNull()
    expect(within(container).queryByText('-1')).toBeNull()
  })

  it.each(['Write', 'FileChange'] as const)('keeps %s counts and renders a prefixed detail diff after expansion', async (toolName) => {
    const subscribe = vi.fn(async () => ({ subscriptionId: 'sub', revision: 0, offset: 0,
      text: JSON.stringify({ input: JSON.stringify({ file_path: '/proj/a.ts', kind: 'add' }),
        toolDiff: '+const value = 1\n+const next = 2', toolLineDelta: { added: 2, removed: 0 } }) }))
    const client = createDetailClient({ subscribe, unsubscribe: () => {} }, { newId: () => crypto.randomUUID() })
    const { container } = render(<DetailScopeProvider scope={{ client, environmentId: 'node', sessionId: 'session' }}>
      <ToolBlock {...{ toolName, toolUseId: 'edit', input: '{"file_path":"/proj/a.ts","kind":"add"}',
        status: 'complete' as const, toolLineDelta: { added: 2, removed: 0 }, remoteDetail: 'detail' }} />
    </DetailScopeProvider>)
    expect(within(container).getByText('+2')).toBeVisible()
    expect(subscribe).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(container.querySelector('.tool-node > div')!) })
    expect(subscribe).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(container).toHaveTextContent('const value = 1'))
    expect(container).not.toHaveTextContent('++const')
    expect(within(container).getByText('+2')).toBeVisible()
  })
})
