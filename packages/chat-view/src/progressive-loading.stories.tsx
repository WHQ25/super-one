import { useEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { installHostBridge } from './bridge'
import { deliverDetail } from './detail-stream'
import { DeferredReasoning } from './DeferredReasoning'
import { DeferredCodexTool, DeferredTool } from './DeferredTool'
import { PortableMessage } from './PortableMessage'

function ProgressiveLoading({ state = 'ready' }: { state?: 'ready' | 'loading' | 'error' | 'long' | 'edit' }) {
  useEffect(() => {
    const host = globalThis as typeof globalThis & { ReactNativeWebView?: { postMessage(raw: string): void }; __applyHost?: (value: unknown) => void }
    const previous = host.ReactNativeWebView
    const remove = installHostBridge(message => { if (message.type === 'detailUpdate') deliverDetail(message) })
    host.ReactNativeWebView = { postMessage(raw) {
      const request = JSON.parse(raw)
      if (request.action !== 'subscribeDetail' || state === 'loading') return
      const text = 'Content arrives only after expansion. '.repeat(state === 'long' ? 100 : 1)
      const toolText = state === 'edit'
        ? JSON.stringify({
          input: JSON.stringify({ file_path: '/workspace/apps/mobile/src/config.ts' }),
          toolDiff: '-const previewEnabled = false\n+const previewEnabled = true',
          toolLineDelta: { added: 1, removed: 1 },
        })
        : JSON.stringify({ input: '{"command":"pwd","description":"Print working directory"}', result: text })
      host.__applyHost?.({ type: 'nativeActionResult', requestId: request.requestId,
        ...(state === 'error' ? { error: 'Unable to load. Collapse and reopen to retry.' } : { result: {
          subscriptionId: request.payload.subscriptionId, revision: 0, offset: 0,
          text: request.payload.detailRef.includes('tool') ? toolText : text,
        } }),
      })
    } }
    return () => { remove(); host.ReactNativeWebView = previous }
  }, [state])
  return <div className="mx-auto max-w-[390px] space-y-4 p-4">
    {state === 'edit' ? (
      <DeferredTool
        remoteDetail={`story-${state}-tool`}
        toolName="Edit"
        input={JSON.stringify({ file_path: '/workspace/apps/mobile/src/config.ts' })}
        toolLineDelta={{ added: 1, removed: 1 }}
        status="complete"
      />
    ) : (
      <>
        <DeferredReasoning text="" blockDone={false} remoteDetails={[`story-${state}-reasoning`]} />
        <DeferredTool
          remoteDetail={`story-${state}-tool`}
          toolName="Bash"
          input={'{"command":"pwd","description":"Print working directory"}'}
          toolSummary="Print working directory"
          status={state === 'ready' || state === 'long' || state === 'error' ? 'complete' : 'streaming'}
        />
      </>
    )}
  </div>
}
const meta = { title: 'Chat/Mobile progressive loading', component: ProgressiveLoading } satisfies Meta<typeof ProgressiveLoading>
export default meta
type Story = StoryObj<typeof meta>
export const OnDemand: Story = {}
export const Loading: Story = { args: { state: 'loading' } }
export const FailureAndRetry: Story = { args: { state: 'error' } }
export const LongContent: Story = { args: { state: 'long' } }
export const GrokBashExpanded: Story = {
  name: 'Grok Bash · description header + terminal',
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>('.tool-node > div')?.click()
  },
}
export const EditHeaderDelta: Story = { args: { state: 'edit' } }
export const BrowserScreenshot: Story = {
  name: 'Browser screenshot · collapsed desktop row',
  render: () => (
    <div className="mx-auto max-w-[390px] p-4">
      <PortableMessage
        message={{
          id: 'progressive-screenshot',
          role: 'assistant',
          status: 'complete',
          providerId: 'claude',
          createdAt: '2026-09-09T00:00:00Z',
          content: [
            {
              type: 'tool_use',
              toolName: 'mcp__superone__browser_snapshot',
              toolUseId: 'shot',
              input: JSON.stringify({ include: ['screenshot'], description: 'Google home' }),
              status: 'complete',
              remoteDetail: 'story-screenshot-tool',
            },
            {
              type: 'tool_result',
              toolUseId: 'shot',
              summary: JSON.stringify({ path: '/tmp/google.png', width: 960, height: 1636 }),
            },
          ],
        }}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming={false}
      />
    </div>
  ),
}

/**
 * A projected SuperOne session_list: the dedicated archive row is the chrome.
 * There must be no generic `superone · session list` shell wrapping it.
 */
function ProgressiveSessionList() {
  useEffect(() => {
    const host = globalThis as typeof globalThis & { ReactNativeWebView?: { postMessage(raw: string): void }; __applyHost?: (value: unknown) => void }
    const previous = host.ReactNativeWebView
    const remove = installHostBridge(message => { if (message.type === 'detailUpdate') deliverDetail(message) })
    host.ReactNativeWebView = { postMessage(raw) {
      const request = JSON.parse(raw)
      if (request.action !== 'subscribeDetail') return
      host.__applyHost?.({
        type: 'nativeActionResult',
        requestId: request.requestId,
        result: {
          subscriptionId: request.payload.subscriptionId,
          revision: 0,
          offset: 0,
          text: JSON.stringify({
            input: JSON.stringify({ harness: 'acp' }),
            result: JSON.stringify({ sessions: [], count: 0 }),
          }),
        },
      })
    } }
    return () => { remove(); host.ReactNativeWebView = previous }
  }, [])
  return (
    <div className="mx-auto max-w-[390px] p-4">
      <PortableMessage
        message={{
          id: 'progressive-session-list',
          role: 'assistant',
          status: 'complete',
          providerId: 'acp',
          createdAt: '2026-09-11T00:00:00Z',
          content: [
            {
              type: 'tool_use',
              toolName: 'mcp__superone__session_list',
              toolUseId: 'list',
              input: JSON.stringify({ harness: 'acp' }),
              status: 'complete',
              remoteDetail: 'story-session-list',
            },
          ],
        }}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming={false}
      />
    </div>
  )
}

export const SessionListDedicated: Story = {
  name: 'session_list · dedicated row, no generic shell',
  render: () => <ProgressiveSessionList />,
}

export const EditExpandedDiff: Story = {
  args: { state: 'edit' },
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>('.tool-node > div')?.click()
  },
}

/**
 * A projected Task block: the transcript carries only the shell (description via
 * `toolSummary`, input dropped past the size cap); prompt, child rows and result
 * arrive when the card itself is expanded. There must be exactly one card — no
 * generic tool row wrapping it.
 */
function ProgressiveSubagent({ state = 'ready', running = false }: { state?: 'ready' | 'loading' | 'error'; running?: boolean }) {
  useEffect(() => {
    const host = globalThis as typeof globalThis & { ReactNativeWebView?: { postMessage(raw: string): void }; __applyHost?: (value: unknown) => void }
    const previous = host.ReactNativeWebView
    const remove = installHostBridge(message => { if (message.type === 'detailUpdate') deliverDetail(message) })
    host.ReactNativeWebView = { postMessage(raw) {
      const request = JSON.parse(raw)
      if (request.action !== 'subscribeDetail' || state === 'loading') return
      const detail = JSON.stringify({
        input: JSON.stringify({ subagent_type: 'explore', description: 'Explore mobile image click flow', prompt: 'Find every image tap handler in apps/mobile and list the file paths.' }),
        result: running ? undefined : 'Found three handlers: chat image, gallery thumbnail, widget preview.',
        childBlocks: [
          { type: 'tool_use', toolUseId: 'child-grep', toolName: 'Grep', input: '{"pattern":"onPress"}', status: 'complete', parentToolUseId: 'task', remoteDetail: 'story-subagent-child-grep' },
          { type: 'tool_result', toolUseId: 'child-grep', summary: '', parentToolUseId: 'task' },
          { type: 'tool_use', toolUseId: 'child-read', toolName: 'Read', input: '{"file_path":"apps/mobile/src/ui/host-image.tsx"}', status: running ? 'streaming' : 'complete', parentToolUseId: 'task', remoteDetail: 'story-subagent-child-read' },
        ],
      })
      host.__applyHost?.({ type: 'nativeActionResult', requestId: request.requestId,
        ...(state === 'error' ? { error: 'Unable to load. Collapse and reopen to retry.' } : { result: {
          subscriptionId: request.payload.subscriptionId, revision: 0, offset: 0,
          text: request.payload.detailRef === 'story-subagent-task' ? detail : JSON.stringify({ input: '{}', result: 'child output' }),
        } }),
      })
    } }
    return () => { remove(); host.ReactNativeWebView = previous }
  }, [state, running])
  return (
    <div className="mx-auto max-w-[390px] p-4">
      <PortableMessage
        message={{
          id: 'progressive-subagent',
          role: 'assistant',
          status: running ? 'streaming' : 'complete',
          providerId: 'cursor',
          createdAt: '2026-09-09T00:00:00Z',
          content: [
            { type: 'tool_use', toolName: 'Task', toolUseId: 'task', input: '{}', status: running ? 'streaming' : 'complete',
              toolSummary: 'Explore mobile image click flow', remoteDetail: 'story-subagent-task' },
            ...(running ? [] : [{ type: 'tool_result' as const, toolUseId: 'task', summary: '' }]),
          ],
        }}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming={running}
      />
    </div>
  )
}

const expandSubagent = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  canvasElement.querySelector<HTMLElement>('.subagent-container > button')?.click()
}

export const SubagentCollapsed: StoryObj<typeof ProgressiveSubagent> = {
  name: 'Subagent · collapsed shell (single card)',
  render: (args) => <ProgressiveSubagent {...args} />,
}
export const SubagentExpanded: StoryObj<typeof ProgressiveSubagent> = {
  name: 'Subagent · expanded loads prompt, child rows, output',
  render: (args) => <ProgressiveSubagent {...args} />,
  play: expandSubagent,
}
export const SubagentRunning: StoryObj<typeof ProgressiveSubagent> = {
  name: 'Subagent · running, expanded',
  render: (args) => <ProgressiveSubagent {...args} running />,
  play: expandSubagent,
}
export const SubagentLoading: StoryObj<typeof ProgressiveSubagent> = {
  name: 'Subagent · detail loading',
  render: (args) => <ProgressiveSubagent {...args} state="loading" />,
  play: expandSubagent,
}
export const SubagentFailureAndRetry: StoryObj<typeof ProgressiveSubagent> = {
  name: 'Subagent · detail failed, retry',
  render: (args) => <ProgressiveSubagent {...args} state="error" />,
  play: expandSubagent,
}

/**
 * A projected tool with no dedicated presenter (Cursor `ReadLints`, a third-party MCP
 * call). Expanding the shell must show the fetched result inside the same row — never a
 * second generic row nested in the first — while a tool that does own a presenter
 * (`ListAgents`) still mounts that presenter in the body.
 */
const GENERIC_DEFERRED_TOOLS = {
  readLints: {
    toolName: 'ReadLints',
    detail: { input: JSON.stringify({ paths: ['apps/mobile/src/ui/host-image.tsx'] }), result: '{\n  "totalFiles": 1,\n  "totalDiagnostics": 0\n}' },
  },
  mcp: {
    toolName: 'mcp__context7__query_docs',
    detail: { input: JSON.stringify({ query: 'useEffect cleanup' }), result: '{"content":[{"type":"text","text":"Effects run after paint…"}]}' },
  },
  listAgents: {
    toolName: 'ListAgents',
    detail: { input: '{}', result: 'Peer sessions (1):\n  reviewer · codex · interactive · active 2m ago' },
  },
} as const

function ProgressiveGenericTool({ tool }: { tool: keyof typeof GENERIC_DEFERRED_TOOLS }) {
  const { toolName, detail } = GENERIC_DEFERRED_TOOLS[tool]
  useEffect(() => {
    const host = globalThis as typeof globalThis & { ReactNativeWebView?: { postMessage(raw: string): void }; __applyHost?: (value: unknown) => void }
    const previous = host.ReactNativeWebView
    const remove = installHostBridge(message => { if (message.type === 'detailUpdate') deliverDetail(message) })
    host.ReactNativeWebView = { postMessage(raw) {
      const request = JSON.parse(raw)
      if (request.action !== 'subscribeDetail') return
      host.__applyHost?.({ type: 'nativeActionResult', requestId: request.requestId, result: {
        subscriptionId: request.payload.subscriptionId, revision: 0, offset: 0, text: JSON.stringify(detail),
      } })
    } }
    return () => { remove(); host.ReactNativeWebView = previous }
  }, [detail])
  return (
    <div className="mx-auto max-w-[390px] p-4">
      <PortableMessage
        message={{
          id: `progressive-generic-${tool}`,
          role: 'assistant',
          status: 'complete',
          providerId: 'cursor',
          createdAt: '2026-09-09T00:00:00Z',
          content: [
            { type: 'tool_use', toolName, toolUseId: `generic-${tool}`, input: '', status: 'complete', remoteDetail: `story-generic-${tool}` },
          ],
        }}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming={false}
      />
    </div>
  )
}

const expandToolRow = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  canvasElement.querySelector<HTMLElement>('.tool-node-header')?.click()
}

export const GenericToolCollapsed: StoryObj<typeof ProgressiveGenericTool> = {
  name: 'Generic tool · collapsed shell (ReadLints)',
  render: () => <ProgressiveGenericTool tool="readLints" />,
}
export const GenericToolExpanded: StoryObj<typeof ProgressiveGenericTool> = {
  name: 'Generic tool · expanded shows result in the same row',
  render: () => <ProgressiveGenericTool tool="readLints" />,
  play: expandToolRow,
}
export const McpToolExpanded: StoryObj<typeof ProgressiveGenericTool> = {
  name: 'Third-party MCP tool · expanded, single row',
  render: () => <ProgressiveGenericTool tool="mcp" />,
  play: expandToolRow,
}
export const DedicatedPresenterExpanded: StoryObj<typeof ProgressiveGenericTool> = {
  name: 'ListAgents · expanded mounts its own presenter',
  render: () => <ProgressiveGenericTool tool="listAgents" />,
  play: expandToolRow,
}

const CODEX_PATCH = {
  id: 'codex-patch',
  type: 'file_change',
  status: 'completed',
  changes: [
    { path: '/workspace/packages/chat-view/src/BrowserChromeView.tsx', kind: 'update', diff: '@@ -1,3 +1,3 @@\n import { useState } from \'react\'\n-const compact = false\n+const compact = true' },
    { path: '/workspace/packages/chat-view/src/browser-chrome.css', kind: 'update', diff: '@@ -4,2 +4,3 @@\n .chrome { display: flex; }\n+.chrome { gap: 4px; }' },
  ],
} as const

function ProgressiveCodexFileChange({ files, state = 'ready' }: { files: 1 | 2; state?: 'ready' | 'error' }) {
  const changes = CODEX_PATCH.changes.slice(0, files)
  useEffect(() => {
    const host = globalThis as typeof globalThis & { ReactNativeWebView?: { postMessage(raw: string): void }; __applyHost?: (value: unknown) => void }
    const previous = host.ReactNativeWebView
    const remove = installHostBridge(message => { if (message.type === 'detailUpdate') deliverDetail(message) })
    host.ReactNativeWebView = { postMessage(raw) {
      const request = JSON.parse(raw)
      if (request.action !== 'subscribeDetail') return
      host.__applyHost?.({ type: 'nativeActionResult', requestId: request.requestId,
        ...(state === 'error' ? { error: 'Unable to load. Collapse and reopen to retry.' } : { result: {
          subscriptionId: request.payload.subscriptionId, revision: 0, offset: 0,
          text: JSON.stringify({ item: { ...CODEX_PATCH, changes } }),
        } }),
      })
    } }
    return () => { remove(); host.ReactNativeWebView = previous }
  }, [changes, state])
  return (
    <div className="mx-auto max-w-[390px] p-4">
      <DeferredCodexTool isStreaming={false} item={{
        ...CODEX_PATCH,
        remoteDetail: `story-codex-patch-${files}`,
        toolLineDelta: files === 1 ? { added: 1, removed: 1 } : { added: 2, removed: 1 },
        changes: changes.map(({ path, kind }, index) => ({ path, kind, toolLineDelta: index === 0 ? { added: 1, removed: 1 } : { added: 1, removed: 0 } })),
      }} />
    </div>
  )
}

export const CodexFileChangeCollapsed: StoryObj<typeof ProgressiveCodexFileChange> = {
  name: 'Codex patch · one row per file',
  render: () => <ProgressiveCodexFileChange files={2} />,
}
export const CodexFileChangeExpanded: StoryObj<typeof ProgressiveCodexFileChange> = {
  name: 'Codex patch · expanded diff stays in its row',
  render: () => <ProgressiveCodexFileChange files={1} />,
  play: expandToolRow,
}
export const CodexFileChangeFailure: StoryObj<typeof ProgressiveCodexFileChange> = {
  name: 'Codex patch · detail failed, retry',
  render: () => <ProgressiveCodexFileChange files={1} state="error" />,
  play: expandToolRow,
}
