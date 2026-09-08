import type { StoryObj } from '@storybook/react-vite'
import { ToolBlock } from './ToolBlock'
import { memoryStories } from './interaction-memory-story-fixtures'

const stories = memoryStories('browser', { domain: 'github.com' })
export default { ...stories.defaults, title: 'Tool UI/SuperOne MCP/Browser Memory' }
type Story = StoryObj<typeof ToolBlock>

export const Read = stories.Read
export const Expanded = stories.Expanded
export const Empty = stories.Empty
export const Loading = stories.Loading
export const Saved = stories.Saved
export const Archived = stories.Archived
export const Restored = stories.Restored
export const Conflict = stories.Conflict
export const Denied = stories.Denied
export const Nested = stories.Nested
export const Narrow = stories.Narrow

export const ActionRead: Story = { args: { toolName: 'mcp__superone__browser_action', input: JSON.stringify({ action: 'read', domain: 'github.com', name: 'search' }), result: JSON.stringify({ action: { domain: 'github.com', name: 'search', parameters: [], steps: [{ kind: 'tool', tool: 'browser_snapshot', args: {} }] } }) } }
export const ActionArchived: Story = { args: { toolName: 'mcp__superone__browser_action', input: JSON.stringify({ action: 'archive', domain: 'github.com', name: 'search' }), result: JSON.stringify({ ok: true, action: { domain: 'github.com', name: 'search', archived: true } }) } }
