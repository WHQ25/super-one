import { describe, expect, it } from 'vitest'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { buildCompactBoundaryMessage } from '@superone/shared/compact-boundary'
import { contentKeys } from '@superone/shared/transcript-boundary'
import { processTurn } from '@superone/shared/transcript-window/window-fixtures'
import { collapsibleItems, compactTurnRuns, countVisibleClaudeProcessSegments, partitionTurnForCompactMode } from './compact-mode'
import { groupContentPresenter } from './group-content'
import { isHiddenToolBlock } from './media-tools'
import { isPortablePinnedSegment, portableToolBlocks, PORTABLE_GROUP_PORTS, turnDisplayContent } from './portable'
import { planProcessFolds } from './process-folds'
import { summarizeClaudeProcess } from './process-stats'

/** The Detail header the phone draws for a fully loaded turn. */
function loadedHeader(message: ChatMessage) {
  const grouped = groupContentPresenter(message.content, PORTABLE_GROUP_PORTS)
  const process = collapsibleItems(partitionTurnForCompactMode(grouped.segments, isPortablePinnedSegment))
  return summarizeClaudeProcess(process, {
    toolResultAt: (id) => grouped.toolResultMap.get(id),
    isHiddenTool: isHiddenToolBlock,
    isErrorTool: (id) => grouped.errorToolIds.has(id),
    bashEditDiffAt: (id) => grouped.bashEditDiffMap.get(id),
  })
}

const call = (toolName: string, toolUseId: string, input: unknown = {}): ContentBlock =>
  ({ type: 'tool_use', toolName, toolUseId, input: JSON.stringify(input), status: 'complete' })
const result = (toolUseId: string, summary = 'ok'): ContentBlock => ({ type: 'tool_result', toolUseId, summary })
const turn = (content: ContentBlock[], status: ChatMessage['status'] = 'complete'): ChatMessage =>
  ({ id: 'a', role: 'assistant', status, createdAt: '', providerId: 'claude', content })

describe('planProcessFolds', () => {
  it('folds the process a settled turn collapses, with the header the loaded turn shows', () => {
    const message = processTurn('a', 12)
    const plan = planProcessFolds(message)
    expect(plan.ranges).toHaveLength(1)
    const [range] = plan.ranges
    expect(range).toMatchObject({ start: 0, end: message.content.length - 2 })
    const header = loadedHeader(message)
    expect({ toolCalls: range.summary.toolCalls, filesChanged: range.summary.files.length, added: range.summary.added, removed: range.summary.removed })
      .toEqual(header)
    expect(range.summary.files.sort()).toEqual(['/src/file2.ts', '/src/file5.ts'])
  })

  it('leaves streaming, user and barely collapsing turns whole', () => {
    expect(planProcessFolds(processTurn('a', 12, 'streaming')).ranges).toEqual([])
    expect(planProcessFolds({ ...processTurn('a', 12), role: 'user' }).ranges).toEqual([])
    // Thinking plus one read group: two visible segments, under the threshold.
    const reads = turn([{ type: 'thinking', thinking: '' }, call('Read', 'r1'), result('r1'), call('Read', 'r2'), result('r2'), { type: 'text', text: 'done' }])
    expect(planProcessFolds(reads).ranges).toEqual([])
  })

  it('keeps what the collapsed turn shows or reads in place', () => {
    const content: ContentBlock[] = [
      ...['b1', 'b2', 'b3'].flatMap((id) => [call('Bash', id, { command: `echo ${id}` }), result(id)]),
      // A widget is pinned, and its result feeds it.
      call('mcp__superone__widget_show', 'w'),
      ...['b4', 'b5'].flatMap((id) => [call('Bash', id, { command: `echo ${id}` }), result(id)]),
      result('w'),
      // A generation feeds the turn-end gallery.
      call('mcp__superone__media_generate_image', 'img'), result('img', '{"status":"generated","savedPaths":["/a.png"]}'),
      ...['b6', 'b7'].flatMap((id) => [call('Bash', id, { command: `echo ${id}` }), result(id)]),
      { type: 'text', text: 'done' },
    ]
    const plan = planProcessFolds(turn(content))
    const folded = new Set(plan.ranges.flatMap(({ start, end }) => Array.from({ length: end - start + 1 }, (_, i) => start + i)))
    const index = (predicate: (block: ContentBlock) => boolean) => content.findIndex(predicate)
    expect(folded.has(index((block) => block.type === 'tool_use' && block.toolName.endsWith('widget_show')))).toBe(false)
    expect(folded.has(index((block) => block.type === 'tool_result' && block.toolUseId === 'w'))).toBe(false)
    expect(folded.has(index((block) => block.type === 'tool_use' && block.toolUseId === 'img'))).toBe(false)
    expect(plan.ranges.map(({ start, end }) => [start, end])).toEqual([[0, 5], [7, 10], [14, 17]])
    const total = plan.ranges.reduce((sum, range) => sum + range.summary.toolCalls, 0)
    expect(total).toBe(7)
  })

  it('leaves off-transcript text out of folds', () => {
    const content: ContentBlock[] = [
      ...['b1', 'b2'].flatMap((id) => [call('Bash', id), result(id)]),
      { type: 'text', text: 'question', codexAsyncQuestions: [{ title: 'Which?', options: null }] },
      ...['b3', 'b4'].flatMap((id) => [call('Bash', id), result(id)]),
      { type: 'text', text: 'done' },
    ]
    expect(planProcessFolds(turn(content)).ranges.map(({ start, end }) => [start, end])).toEqual([[0, 3], [5, 8]])
  })

  it('summarizes the rest of a fold past a page', () => {
    const message = processTurn('a', 12)
    const plan = planProcessFolds(message)
    // Blocks 1..6 are the first three calls and results; the rest starts at block 7.
    const rest = plan.summarize(7, plan.ranges[0].end)
    expect(rest.toolCalls).toBe(9)
    expect(rest.segments).toBeGreaterThan(0)
  })

  it('does not fold across a transcript cut, and leaves the tail after a pin visible', () => {
    const bash = (id: string) => [call('Bash', id, { command: `echo ${id}` }), result(id)]
    const first = ['b1', 'b2', 'b3', 'b4'].flatMap(bash)
    const second = ['b5', 'b6', 'b7', 'b8'].flatMap(bash)
    const cut = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 10 }, 'cut', '', turn(first))
    const across = turn([...first, ...second, { type: 'text', text: 'Done' }])
    const split = planProcessFolds(across, { cuts: [cut] })
    const cutAt = first.length
    expect(split.ranges.some((range) => range.start < cutAt && range.end >= cutAt)).toBe(false)
    expect(split.ranges.map(({ start, end }) => [start, end])).toEqual([[0, 7], [8, 15]])

    const prefix = [...first, { type: 'text' as const, text: 'Answer' }]
    const tailCut = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 10 }, 'tail-cut', '', turn(prefix))
    const tail = turn([...prefix, ...second])
    const planned = planProcessFolds(tail, { cuts: [tailCut] })
    const folded = new Set(planned.ranges.flatMap(({ start, end }) => Array.from({ length: end - start + 1 }, (_, i) => start + i)))
    expect(folded.has(0)).toBe(true)
    for (let index = prefix.length; index < tail.content.length; index++) expect(folded.has(index)).toBe(false)
  })

  it('keeps an image inside a process out of the fold and counts the same segments', () => {
    const bash = (id: string) => [call('Bash', id, { command: `echo ${id}` }), result(id)]
    const content: ContentBlock[] = [
      ...['b1', 'b2', 'b3', 'b4'].flatMap(bash),
      call('mcp__superone__media_generate_image', 'img'), result('img', '{"status":"generated","savedPaths":["/a.png"]}'),
      ...['b5', 'b6', 'b7', 'b8'].flatMap(bash),
      { type: 'text', text: 'done' },
      ...['b9', 'b10', 'b11', 'b12'].flatMap(bash),
    ]
    const message = turn(content)
    const plan = planProcessFolds(message)
    const folded = new Set(plan.ranges.flatMap(({ start, end }) => Array.from({ length: end - start + 1 }, (_, i) => start + i)))
    const image = content.findIndex((block) => block.type === 'tool_use' && block.toolUseId === 'img')
    expect(folded.has(image)).toBe(false)
    expect(folded.has(image + 1)).toBe(false)
    const done = content.findIndex((block) => block.type === 'text')
    for (let index = done; index < content.length; index++) expect(folded.has(index)).toBe(false)
    const grouped = groupContentPresenter(portableToolBlocks(turnDisplayContent(message)), PORTABLE_GROUP_PORTS)
    const visible = countVisibleClaudeProcessSegments(
      collapsibleItems(compactTurnRuns(grouped.segments, isPortablePinnedSegment)),
      { toolResultAt: (id) => grouped.toolResultMap.get(id), isHiddenTool: isHiddenToolBlock },
    )
    expect(plan.ranges.reduce((sum, range) => sum + range.summary.segments, 0)).toBe(visible)
    expect(visible).toBe(8)
  })

  it('carries the content keys a transcript boundary reads', () => {
    const message = processTurn('a', 12)
    const [range] = planProcessFolds(message).ranges
    const keys = contentKeys(message.content)
    expect(range.summary.contentKey).toBe(keys[0])
    expect(range.summary.keyCounts).toEqual({ 'thinking:': 1 })
  })
})
