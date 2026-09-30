/** Isolated 0.159 wire check. Never changes a user config or session. */
import { mkdtempSync, copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { openCodexAppServer } from '@superone/codex/app-server-client'
import { createCodexMcpAppsProvider } from '@superone/codex/mcp-apps'
import { mapCodexThreadItem } from '@superone/codex/agent-event-mapper'
const root = resolve(import.meta.dirname, '../../..')
const home = mkdtempSync(join(tmpdir(), 'superone-codex-mcp-apps-'))
const auth = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json')
if (existsSync(auth)) copyFileSync(auth, join(home, 'auth.json'))
const wire = join(home, 'wire.jsonl')
const client = await openCodexAppServer({ binaryPath: join(root, 'node_modules/.bin/codex'), env: { ...process.env, CODEX_HOME: home } })
try {
  const start = await client.request('thread/start', { cwd: root, approvalPolicy: 'never', sandbox: 'read-only',
    config: { mcp_servers: { fixture: { command: 'node', args: [join(root, 'apps/desktop/src/test/fixtures/mcp-apps/fixture-server.ts'), '--stdio'], env: { MCP_APPS_FIXTURE_LOG: wire }, startup_timeout_sec: 20 } } } })
  const threadId = (start.thread as { id: string }).id
  const provider = createCodexMcpAppsProvider({ node: 'wire', session: 'wire', server: 'fixture', configGeneration: 0, configFingerprint: 'fixture' }, threadId, client.request.bind(client))
  const signal = AbortSignal.timeout(120_000)
  await provider.ready(signal)
  const tools = await provider.tools()
  const resource = await provider.readResource({ uri: 'ui://fixture/items.html', origin: { providerSessionId: threadId } }, signal)
  const call = await provider.callTool({ tool: 'fixture_next_page', args: { page: 2 }, origin: { providerSessionId: threadId } }, signal)
  console.log(JSON.stringify({ kind: 'provider', tools: [...tools.keys()], html: Boolean(resource.contents[0]?.text?.includes('Next page')), result: call.result.structuredContent, outcome: call.outcome }))
  const turn = await client.request('turn/start', { threadId, model: 'gpt-6.1-sol', approvalPolicy: 'never', input: [{ type: 'text', text: 'Call fixture_list_items with page 1 exactly once. Do not call any other tool. Then list the fixture tools available in your tool catalog as a JSON array. Do not infer tools from outputs.', text_elements: [] }] })
  const turnId = (turn.turn as { id: string }).id
  const deadline = Date.now() + 120_000
  let completed = false
  let sawAppItem = false
  while (Date.now() < deadline) {
    const note = await client.nextNotification(10_000)
    if (!note) continue
    if (note.method === 'item/agentMessage/delta') console.log(JSON.stringify({ kind: 'model-text', text: note.params.delta }))
    if (note.method === 'item/completed' && (note.params.item as { type?: string })?.type === 'mcpToolCall') {
      const raw = note.params.item as Record<string, unknown>
      const item = mapCodexThreadItem(raw)
      sawAppItem = item?.type === 'mcp_tool_call' && Boolean(item.mcpAppUi)
      console.log(JSON.stringify({ kind: 'model-item', raw, item }))
    }
    if (note.method === 'turn/completed' && (note.params.turn as { id?: string })?.id === turnId) { completed = true; break }
    if (note.method === 'error') console.log(JSON.stringify({ kind: 'error', data: note.params }))
  }
  const lines = existsSync(wire) ? readFileSync(wire, 'utf8').trim().split('\n').map(line => JSON.parse(line).message) : []
  console.log(JSON.stringify({ kind: 'verdict', completed, sawAppItem, initialize: lines.find(line => line.method === 'initialize'), modelVisibleTools: [...tools.entries()].filter(([, tool]) => tool._meta?.ui?.visibility?.includes('model') ?? true).map(([name]) => name) }))
  if (!completed || !sawAppItem) process.exitCode = 1
} finally { await client.close(); rmSync(home, { recursive: true, force: true }) }
