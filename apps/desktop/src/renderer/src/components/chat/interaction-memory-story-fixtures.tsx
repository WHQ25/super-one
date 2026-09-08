import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { ToolBlock } from './ToolBlock'
import { NestedToolContext } from './nested-tool-context'

type Story = StoryObj<typeof ToolBlock>

export function memoryStories(family: 'browser' | 'computer' | 'device', identity: Record<string, string>) {
  const target = { ...identity, topic: 'search' }
  const label = Object.values(target).join('/')
  const note = { ...target, version: 1, summary: 'Search', archived: false, updatedAt: '2026-09-08T14:00:00.000Z', revision: '1', content: 'Use the search field, then wait for the result list.' }
  const write = `mcp__superone__${family}_memory_write`
  const defaults: Meta<typeof ToolBlock> = {
    component: ToolBlock,
    parameters: { layout: 'padded' },
    args: { toolName: `mcp__superone__${family}_memory_read`, input: JSON.stringify(target), status: 'complete', result: JSON.stringify(note) },
    decorators: [(Story) => <div className="@container" style={{ maxWidth: 680 }}><Story /></div>],
  }
  return {
    defaults,
    Read: {} as Story,
    Expanded: {
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByText(label))
        await expect(canvas.getByText(note.content)).toBeVisible()
      },
    } satisfies Story,
    Empty: { args: { input: JSON.stringify(identity), result: JSON.stringify({ ...identity, count: 0, topics: [] }) } } satisfies Story,
    Loading: { args: { status: 'streaming', result: undefined } } satisfies Story,
    Saved: { args: { toolName: write, result: JSON.stringify({ ...note, content: undefined, status: 'saved', created: true }) } } satisfies Story,
    Archived: { args: { toolName: write, input: JSON.stringify({ ...target, archived: true }), result: JSON.stringify({ ...note, content: undefined, status: 'archived', archived: true }) } } satisfies Story,
    Restored: { args: { toolName: write, input: JSON.stringify({ ...target, archived: false }), result: JSON.stringify({ ...note, content: undefined, status: 'saved' }) } } satisfies Story,
    Conflict: { args: { toolName: write, isError: true, result: `[Error] Revision conflict. Read this topic with ${family}_memory_read and merge your changes before retrying.` } } satisfies Story,
    Denied: { args: { result: '[denied] User denied this tool call.' } } satisfies Story,
    Nested: { decorators: [(Story) => <NestedToolContext.Provider value={{ allowExpand: false }}><Story /></NestedToolContext.Provider>] } satisfies Story,
    Narrow: {
      args: { input: JSON.stringify({ ...target, topic: 'a-long-topic-for-searching-and-filtering-many-documents' }) },
      decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
    } satisfies Story,
  }
}
