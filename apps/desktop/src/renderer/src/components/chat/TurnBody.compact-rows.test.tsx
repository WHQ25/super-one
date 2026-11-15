/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ChatMessage, CodexThreadItem } from '@superone/shared/agent-types'
import { buildCompactBoundaryMessage } from '@superone/shared/compact-boundary'
import { transcriptView } from '@superone/shared/transcript-segments'
import { compactProcessHistory } from '@superone/chat-view/fixtures/transcript-segmentation'
import { buildCompactTurn, turnDisplayContent } from '@superone/chat-view/presenters/turn-content'
import { TurnBodyPresenter, type TurnBodyPresenterParts, type TurnBodyPresenterRuntime } from './presenters/TurnBody'
import { groupContent } from './chat-message/groupContent'
import { isClaudePinnedSegment } from './compact-chat-mode'
import { isHiddenToolBlock } from './tool-display'
import { summarizeClaudeProcess } from './turn-process-stats'

const runtime: TurnBodyPresenterRuntime = {
  isBackgroundTool: () => false,
  isPinnedSegment: isClaudePinnedSegment,
  isHiddenTool: isHiddenToolBlock,
  summarizeProcess: summarizeClaudeProcess,
}

const none = () => null
const parts: TurnBodyPresenterParts = {
  Tool: ({ toolUseId }) => <span>{toolUseId}</span>,
  Text: ({ text }) => <p>{text}</p>,
  Insight: none, Document: none, Reasoning: () => <span>reasoning</span>, Subagent: none, Workflow: none, Plan: none,
  ToolGroup: none, AppToolGroup: none, Fold: none,
  TurnDetail: ({ turnId, stats, runs }) => <section data-detail={turnId} data-tools={stats?.toolCalls}>
    {runs.map(run => <div key={run.key} hidden={run.collapsible}>{run.content}</div>)}
  </section>,
}

function Turn({ messages }: { messages: ChatMessage[] }) {
  return <>{transcriptView(messages).rows.filter(row => row.message.role === 'assistant' && row.message.providerId !== 'system').map(row => (
    <article key={row.id} data-row={row.id}>
      <TurnBodyPresenter
        grouped={groupContent(turnDisplayContent(row.message), [])}
        compactTurn={buildCompactTurn(row, content => groupContent(content, []))}
        isStreaming={false} detailChatMode={false} projectPath={null} parts={parts} runtime={runtime}
      />
    </article>
  ))}</>
}

const details = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-detail]')]
  .map(detail => [detail.dataset.detail, detail.dataset.tools])

describe('process disclosure of a turn cut by compaction', () => {
  it('gives each side of the cut its own disclosure and statistics', () => {
    const { container } = render(<Turn messages={compactProcessHistory()} />)
    expect(details(container)).toEqual([['compact-process', '5'], ['compact-process:after:process-compact', '1']])
    expect(screen.getByText('Continuing the implementation.')).toBeVisible()
    expect(screen.getByText('before-compact')).not.toBeVisible()
    expect(screen.getByText('after-compact')).not.toBeVisible()
  })

  it('collapses a short stretch when the whole turn has enough process', () => {
    const [source, compact] = compactProcessHistory()
    const short = { ...source, content: source.content.filter(block => !('toolUseId' in block) || !['before-1', 'before-2', 'before-3'].includes(block.toolUseId)) }
    const { container } = render(<Turn messages={[short, compact]} />)
    expect(details(container)).toEqual([['compact-process', '2'], ['compact-process:after:process-compact', '1']])
  })

  it('draws a stretch without process as it is', () => {
    const [source, compact] = compactProcessHistory()
    const tail = { ...source, content: [...source.content.slice(0, 6), { type: 'text' as const, text: 'The implementation is ready.' }] }
    const { container } = render(<Turn messages={[tail, compact]} />)
    expect(details(container)).toEqual([['compact-process', '5']])
    expect(screen.getByText('The implementation is ready.')).toBeVisible()
  })

  it('splits a legacy Codex turn at every compaction', () => {
    const command = (id: string): CodexThreadItem => ({ id, type: 'command_execution', command: `echo ${id}`, aggregatedOutput: '', status: 'completed', exitCode: 0 })
    const source: ChatMessage = { id: 'legacy', role: 'assistant', providerId: 'codex', content: [], status: 'streaming', createdAt: '',
      metadata: { codex: { threadId: 'thread', usage: null, items: [
        { id: 'progress', type: 'agent_message', text: 'Continuing the implementation.' },
        { id: 'thinking-before', type: 'reasoning', text: 'Plan the work.' }, command('before-compact'),
      ] } } }
    const event = { type: 'compact_boundary' as const, trigger: 'auto' as const, preTokens: 120_000, postTokens: 20_000 }
    const first = buildCompactBoundaryMessage(event, 'first', '', source, [source])
    const middle: ChatMessage = { ...source, metadata: { codex: { ...source.metadata!.codex!, items: [...source.metadata!.codex!.items, command('between-compacts')] } } }
    const second = buildCompactBoundaryMessage(event, 'second', '', middle, [first, middle])
    const complete: ChatMessage = { ...middle, status: 'complete', metadata: { codex: { ...middle.metadata!.codex!, items: [
      ...middle.metadata!.codex!.items, command('after-compacts'),
      { id: 'thinking-after', type: 'reasoning', text: 'Verify the change.' },
      { id: 'answer', type: 'agent_message', text: 'The implementation is ready.' },
    ] } } }
    const { container } = render(<Turn messages={[complete, first, second]} />)
    expect(details(container)).toEqual([['legacy', '1'], ['legacy:after:first', '1'], ['legacy:after:second', '1']])
  })
})
