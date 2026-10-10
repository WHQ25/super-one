import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { createDetailClient, type DetailUpdate } from '@superone/chat-core'
import type { CodexCollabToolCallItem, CodexCommandExecutionItem, CodexFileChangeItem } from '@superone/shared/agent-types'
import { DetailScopeProvider } from '@superone/chat-view/detail-scope'
import { ToolBlock } from './ToolBlock'
import { CodexCommandBlock } from './CodexCommandBlock'
import { CodexSubagentMarker } from './CodexCollabBlock'
import { DesktopReasoning } from './ReasoningBlock'
import { renderCodexItem } from './codex-item-renderer'

type LoadState = 'loaded' | 'loading' | 'error'

const DIFF = '@@ -1,3 +1,3 @@\n export function greet(name: string) {\n-  return `Hi ${name}`\n+  return `Hello, ${name}!`\n }\n'
const LONG_OUTPUT = Array.from({ length: 60 }, (_, i) => `test/suite-${i}.test.ts ✓ ${i * 3 + 2} passed`).join('\n')

const command: CodexCommandExecutionItem = { id: 'cmd', type: 'command_execution', command: 'bun run test', aggregatedOutput: '', status: 'completed', exitCode: 0, remoteDetail: 'cmd' }
const fileChange: CodexFileChangeItem = { id: 'patch', type: 'file_change', status: 'completed', remoteDetail: 'patch',
  changes: [{ path: '/repo/src/greet.ts', kind: 'update', toolLineDelta: { added: 1, removed: 1 } }] }
const collab: CodexCollabToolCallItem = { id: 'spawn', type: 'collab_tool_call', tool: 'spawnAgent', status: 'completed', remoteDetail: 'spawn',
  receiverThreadIds: ['child'], agentsStates: { child: { status: 'completed', nickname: 'Test runner', role: 'worker' } } }

/** What the remote machine returns for each summarized row. */
const DETAILS: Record<string, string> = {
  bash: JSON.stringify({ input: JSON.stringify({ command: 'bun run test', description: 'Run the tests' }), result: LONG_OUTPUT }),
  grep: JSON.stringify({ input: JSON.stringify({ pattern: 'greet', path: '/repo/src' }), result: '/repo/src/greet.ts\n/repo/src/index.ts' }),
  cmd: JSON.stringify({ item: { ...command, aggregatedOutput: LONG_OUTPUT }, input: JSON.stringify({ command: 'bun run test' }), result: LONG_OUTPUT }),
  patch: JSON.stringify({ item: { ...fileChange, changes: [{ ...fileChange.changes[0], diff: DIFF }] } }),
  spawn: JSON.stringify({ item: { ...collab, prompt: 'Run the test suite and report failures.', childItems: { child: [
    { ...command, id: 'child-cmd', remoteDetail: undefined, aggregatedOutput: 'All tests passed' },
  ] } } }),
  think: 'The greeting should end with punctuation, so update the template literal and keep the signature.',
}

/** A detail client whose transport answers from `DETAILS`; `error` fails each row's first attempt so retry recovers. */
function storyClient(state: LoadState) {
  const failed = new Set<string>()
  return createDetailClient({
    subscribe: async (target): Promise<DetailUpdate> => {
      if (state === 'loading') return new Promise(() => {})
      if (state === 'error' && !failed.has(target.detailRef)) { failed.add(target.detailRef); throw new Error('The machine went offline') }
      return { subscriptionId: '', revision: 0, offset: 0, text: DETAILS[target.detailRef] ?? '' }
    },
    unsubscribe: () => {},
  }, { newId: () => crypto.randomUUID() })
}

function Scenario({ state = 'loaded', narrow = false }: { state?: LoadState; narrow?: boolean }) {
  const [scope] = useState(() => ({ client: storyClient(state), environmentId: 'node', sessionId: 'session' }))
  return (
    <DetailScopeProvider scope={scope}>
      <div data-chat-root className="@container mx-auto w-full space-y-1 p-4" style={{ maxWidth: narrow ? 340 : 720 }}>
        <DesktopReasoning text="" blockDone showContent remoteDetails={['think']} />
        <ToolBlock toolName="Bash" toolUseId="bash" input={JSON.stringify({ command: 'bun run test' })} status="complete" remoteDetail="bash" />
        <ToolBlock toolName="Grep" toolUseId="grep" input={JSON.stringify({ pattern: 'greet' })} status="complete" remoteDetail="grep" />
        <CodexCommandBlock item={command} isStreaming={false} />
        {renderCodexItem(fileChange, 0, false)}
        <CodexSubagentMarker item={collab} />
      </div>
    </DetailScopeProvider>
  )
}

/** Opens every collapsed row, the way a user expands them one by one. */
async function expandAll({ canvasElement }: { canvasElement: HTMLElement }) {
  const headers = '.tool-node > div:first-child, .thinking-node > div:first-child, .subagent-container > button'
  for (const header of canvasElement.querySelectorAll<HTMLElement>(headers)) header.click()
}

const meta: Meta<typeof Scenario> = {
  title: 'Chat/Remote/Deferred Rows',
  component: Scenario,
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof Scenario>

export const Collapsed: Story = {}
export const Expanded: Story = { play: expandAll }
export const Loading: Story = { args: { state: 'loading' }, play: expandAll }
export const ErrorRetry: Story = { args: { state: 'error' }, play: expandAll }
export const Narrow: Story = { args: { narrow: true }, play: expandAll }
export const DarkChinese: Story = { globals: { theme: 'dark', locale: 'zh' }, play: expandAll }
