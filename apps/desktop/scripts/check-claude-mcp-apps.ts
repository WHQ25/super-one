/**
 * Live check of the Claude MCP Apps path against the fixture server: provider
 * calls through the shared dispatch gate, then one model turn through the
 * shared mapper. Uses the signed-in Claude account; never touches user config
 * (`settingSources: []`, fixture passed inline).
 *   bun apps/desktop/scripts/check-claude-mcp-apps.ts
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { createClaudeAgentEventMapper } from '@superone/claude/agent-event-mapper'
import { ClaudeMcpAppsCatalog, ClaudeToolApps, createClaudeMcpAppsProvider, withMcpAppsHostEnv } from '@superone/claude/mcp-apps'
import { dispatchMcpAppsProviderRequest } from '@superone/runtime/mcp-apps/provider-rpc'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { McpAppsBinding } from '@superone/shared/mcp-apps'

const root = resolve(import.meta.dirname, '../../..')
const wire = join(tmpdir(), `superone-claude-mcp-apps-${process.pid}.jsonl`)
const binding: McpAppsBinding = { node: 'check', session: 'check', server: 'fixture', configGeneration: 0, configFingerprint: 'fixture' }

let releasePrompt!: () => void
const promptGate = new Promise<void>((r) => { releasePrompt = r })
async function* prompt(): AsyncGenerator<SDKUserMessage> {
  await promptGate
  yield {
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: 'Call the tool mcp__fixture__fixture_list_items with page 2 exactly once, then reply "done".' },
  } as SDKUserMessage
}

const q = query({
  prompt: prompt(),
  options: {
    model: 'haiku',
    settingSources: [],
    env: withMcpAppsHostEnv(undefined),
    mcpServers: {
      fixture: { type: 'stdio', command: 'node', args: [join(root, 'apps/desktop/src/test/fixtures/mcp-apps/fixture-server.ts'), '--stdio'], env: { MCP_APPS_FIXTURE_LOG: wire } },
    },
    canUseTool: async (_name, input) => ({ behavior: 'allow', updatedInput: input }),
    maxTurns: 4,
  },
})

const catalog = new ClaudeMcpAppsCatalog()
let sessionId: string | null = null
// One provider per request, as the IPC and node routes do: dispatch disposes it.
const makeProvider = () => createClaudeMcpAppsProvider(binding, {
  query: async () => q,
  // No Claude session id exists before the first turn; a real View only exists after one.
  providerSessionId: () => sessionId ?? '',
  tools: async () => {
    catalog.update(await q.mcpServerStatus())
    return catalog.tools(binding.server) ?? new Map()
  },
})
const dispatch = (input: Omit<Parameters<typeof dispatchMcpAppsProviderRequest>[0], 'binding' | 'origin'>) =>
  dispatchMcpAppsProviderRequest({ binding, origin: { providerSessionId: sessionId ?? '' }, ...input }, makeProvider())

try {
  const checks = {
    ready: await dispatch({ operation: 'ready' }),
    tools: await dispatch({ operation: 'tools' }),
    read: await dispatch({ operation: 'readResource', uri: 'ui://fixture/items.html' }),
    appOnlyCall: await dispatch({ operation: 'callTool', tool: 'fixture_next_page', args: { page: 2 } }),
    modelOnlyCall: await dispatch({ operation: 'callTool', tool: 'fixture_model_echo', args: { text: 'hi' } }),
    failingCall: await dispatch({ operation: 'callTool', tool: 'fixture_fail', args: {} }),
  }
  const summary = {
    ready: checks.ready,
    toolCount: checks.tools.ok ? (checks.tools.value as unknown[]).length : checks.tools,
    readHasView: checks.read.ok && JSON.stringify(checks.read.value).includes('ui/initialize'),
    appOnlyCall: checks.appOnlyCall,
    modelOnlyCall: checks.modelOnlyCall,
    failingCall: checks.failingCall,
  }
  console.log(JSON.stringify({ kind: 'provider', ...summary }, null, 2))

  const events: AgentEvent[] = []
  const toolApps = new ClaudeToolApps({ catalog, binding: () => binding, providerSessionId: () => sessionId })
  const mapper = createClaudeAgentEventMapper({ messageId: 'check', emit: (e) => events.push(e), toolApps, onSessionId: (id) => { sessionId = id } })
  releasePrompt()
  for await (const message of q) {
    mapper.apply(message)
    if (message.type === 'result') break
  }
  const apps = events.flatMap((e) => (e.type === 'content_delta' && 'app' in e.delta && e.delta.app ? [{ row: e.delta.type, app: e.delta.app }] : []))
  console.log(JSON.stringify({ kind: 'turn', apps }, null, 2))

  const lines = existsSync(wire) ? readFileSync(wire, 'utf8').trim().split('\n').map((l) => JSON.parse(l).message) : []
  const init = lines.find((m) => m.method === 'initialize')
  const verdict = {
    extensionAdvertised: Boolean(init?.params?.capabilities?.extensions?.['io.modelcontextprotocol/ui']),
    appOnlyCallCompleted: checks.appOnlyCall.ok && (checks.appOnlyCall.value as { outcome: string }).outcome === 'completed',
    modelOnlyDenied: !checks.modelOnlyCall.ok && checks.modelOnlyCall.error.code === 'denied',
    failingIsUncertain: checks.failingCall.ok && (checks.failingCall.value as { outcome: string }).outcome === 'unknown_outcome',
    toolUseAttached: apps.some((a) => a.row === 'tool_use' && a.app.status === 'pending'),
    toolResultAttached: apps.some((a) => a.row === 'tool_result' && a.app.toolResult?.structuredContent !== undefined),
  }
  console.log(JSON.stringify({ kind: 'verdict', ...verdict }, null, 2))
  if (!Object.values(verdict).every(Boolean)) process.exitCode = 1
} finally {
  q.close()
  rmSync(wire, { force: true })
}
