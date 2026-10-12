/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContentBlock } from '@superone/shared/agent-types'
import { TranscriptStateProvider, useTranscriptState } from '@superone/ui/lib/transcript-state'
import { groupContentPresenter } from '@superone/chat-view/presenters/groupContent'
import { ClaudeTurnBodyPresenter, type ClaudeTurnBodyPresenterParts, type ClaudeTurnBodyPresenterRuntime } from './presenters/ClaudeTurnBody'
import { VirtualTurnSegment } from './VirtualTranscriptBlock'
import { VirtualTranscriptContext } from './virtual-transcript-context'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function Tool({ toolUseId }: { toolUseId?: string }) {
  const [open, setOpen] = useTranscriptState('open', false)
  return <button onClick={() => setOpen(value => !value)}>{toolUseId}{open ? ' output' : ''}</button>
}
const parts: ClaudeTurnBodyPresenterParts & { Segment: typeof VirtualTurnSegment } = {
  Segment: VirtualTurnSegment,
  Tool,
  Text: ({ text }) => <p>{text}</p>,
  Insight: () => null,
  Document: () => null,
  Reasoning: () => null,
  Subagent: () => null,
  Workflow: () => null,
  ToolGroup: () => null,
  AppToolGroup: () => null,
  TurnDetail: ({ runs }) => <>{runs.map(run => <div key={run.key}>{run.content}</div>)}</>,
}
const runtime: ClaudeTurnBodyPresenterRuntime = {
  isBackgroundTool: () => false,
  isPinnedSegment: segment => segment.kind === 'block' && segment.block.type === 'text',
  isHiddenTool: () => false,
  summarizeProcess: () => ({ toolCalls: 96, filesChanged: 0, added: 0, removed: 0 }),
}
function group(content: ContentBlock[]) {
  return groupContentPresenter(content, {
    isSubagentToolName: () => false,
    isWorkflowSmokeCheck: () => false,
    isHiddenToolBlock: () => false,
    resolveAppTool: () => null,
  })
}
const content: ContentBlock[] = Array.from({ length: 96 }, (_, index) => ({
  type: 'tool_use', toolName: 'Bash', toolUseId: `command-${index}`,
  input: JSON.stringify({ command: `echo ${index}` }), status: 'complete',
}))

describe('shared ContentBlock turn virtualization', () => {
  it.each([
    { isStreaming: true, detailChatMode: false },
    { isStreaming: false, detailChatMode: true },
    { isStreaming: false, detailChatMode: false },
  ])('evicts activities and preserves tool state in $isStreaming/$detailChatMode mode', props => {
    const observed = new Map<string, (visible: boolean) => void>()
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const values = new Map<string, unknown>()
    const view = (blocks: ContentBlock[]) => (
      <TranscriptStateProvider values={values} scope="turn">
        <VirtualTranscriptContext.Provider value={{ viewportRef: { current: null }, observeBlock: (node, callback) => {
          observed.set(node.dataset.virtualSegment!, callback)
          return () => { observed.delete(node.dataset.virtualSegment!) }
        } }}>
          <ClaudeTurnBodyPresenter {...props} grouped={group(blocks)} parts={parts} runtime={runtime} projectPath={null} />
        </VirtualTranscriptContext.Provider>
      </TranscriptStateProvider>
    )
    const { rerender } = render(view(content))
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(observed.size).toBe(12)
    const first = [...observed.values()][0]
    act(() => first(true))
    expect(screen.getAllByRole('button')).toHaveLength(8)
    fireEvent.click(screen.getByText('command-0'))
    expect(screen.getByText('command-0 output')).toBeVisible()
    act(() => first(false))
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    // Appending the live tail must keep earlier chunk IDs and disclosure scopes.
    rerender(view([...content, { type: 'text', text: 'Newest streamed reply' }]))
    act(() => first(true))
    expect(screen.getByText('command-0 output')).toBeVisible()
    act(() => [...observed.values()].at(-1)!(true))
    expect(screen.getByText('Newest streamed reply')).toBeVisible()
  })

  it('renders the full turn when the host has no virtual transcript viewport', () => {
    render(<ClaudeTurnBodyPresenter grouped={group(content)} isStreaming detailChatMode={false} parts={parts} runtime={runtime} projectPath={null} />)
    expect(screen.getAllByRole('button')).toHaveLength(96)
  })
})
