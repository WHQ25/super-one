import { expect, it } from 'vitest'
import type { CodexCollabToolCallItem, CodexMcpToolCallItem } from '@superone/shared/agent-types'
import { mergeCodexCollabDetail } from './codex-collab-detail'
import { codexCollabViewModel } from './presenters/CodexCollabBlock'

const app: CodexMcpToolCallItem = { id: 'app', type: 'mcp_tool_call', server: 'fixture', tool: 'next', arguments: {}, status: 'completed', app: { appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'cfg' }, resourceUri: 'ui://fixture/view', status: 'result', modelContext: null, toolResult: { content: [], structuredContent: { page: 2 } } } }
const collab = (childItems: CodexCollabToolCallItem['childItems']): CodexCollabToolCallItem => ({ id: 'spawn', type: 'collab_tool_call', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['child'], agentsStates: {}, childItems })

it('uses current child App data and authoritative clears over cached detail, while keeping ordinary detail', () => {
  const old = { ...app, status: 'in_progress' as const, app: { ...app.app!, modelContext: { updateId: 'old', content: [], source: { appInstanceId: 'view', server: 'fixture' } } } }
  const bash = { id: 'bash', type: 'command_execution' as const, status: 'completed' as const, command: 'pwd', aggregatedOutput: '/project' }
  const merged = mergeCodexCollabDetail(collab({ child: [app], sibling: [app] }), { ...collab({ child: [bash, old] }), prompt: 'loaded prompt' })
  expect(merged.prompt).toBe('loaded prompt')
  expect(merged.childItems!.child).toEqual([bash, app])
  expect(merged.childItems!.sibling).toEqual([app])
  expect(codexCollabViewModel(merged).activityItems).toHaveLength(3)
})

it('keeps a newly arriving App below a nested collaboration even when cached detail lacks it', () => {
  const shell = collab({ child: [collab({ grandchild: [app] })] })
  const loaded = collab({ child: [collab({ grandchild: [] })] })
  expect(mergeCodexCollabDetail(shell, loaded)).toMatchObject({ childItems: { child: [{ childItems: { grandchild: [app] } }] } })
})
