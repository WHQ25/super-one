import { memoryStories } from './interaction-memory-story-fixtures'

const stories = memoryStories('computer', { platform: 'macos', appId: 'com.apple.TextEdit' })
export default { ...stories.defaults, title: 'Tool UI/SuperOne MCP/Computer Memory' }

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
