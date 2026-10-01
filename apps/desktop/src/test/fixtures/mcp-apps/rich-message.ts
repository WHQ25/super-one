import type { McpAppMessageParams } from '@superone/shared/mcp-apps'

export const richMcpAppMessage: McpAppMessageParams = { role: 'user', content: [
  { type: 'text', text: 'Compare these parts.' },
  { type: 'text', text: '{"part":"agent-dial","material":"PLA"}', _meta: { 'openai/title': 'Agent dial' } },
  { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=', _meta: { 'openai/title': 'Assembly drawing' } },
  { type: 'resource_link', uri: 'file:///parts/agent-dial.stl', name: 'agent-dial.stl', _meta: { 'openai/title': 'CAD source' } },
  { type: 'resource', resource: { uri: 'data:part-manual', text: 'Fit the dial onto the spindle.' }, _meta: { 'openai/title': 'Part manual' } },
] }
