// D-route spike: embed dsh in-process, drive it like SuperOne's main process would.
// E2: minimal Cordis tree + mock LLM adapter → full session/event stream
// E3: custom tool + tool/call → tool/result capture
// E4: approval seam answered in-process (HITL)
// E5: mid-turn cancel + runtime plugin hot mount/unmount
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import ApprovalService from '@deepseek-ai/dsh-user-approval'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (tag, ...rest) => console.log(`[${tag}]`, ...rest)

// ---------- mock adapter ----------
class MockAdapter extends LlmAdapter {
  lastSeenTools = []
  async *stream(options) {
    this.lastSeenTools = (options.tools ?? []).map((t) => t.name)
    const last = options.messages[options.messages.length - 1]
    const lastText = JSON.stringify(last?.content ?? '')
    if (last?.role === 'tool') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'tool said pong, done.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'tool said pong, done.' } }
      yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    if (lastText.includes('TOOL')) {
      const id = `call-${randomUUID().slice(0, 8)}`
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'ping', argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'ping', arguments: '{}' } }
      yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 3 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (lastText.includes('SLOW')) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      for (let i = 0; i < 20; i++) {
        if (options.signal?.aborted) {
          yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'caller aborted', code: 'ABORTED' } } }
          return
        }
        yield { type: 'text-delta', index: 0, text: `slow-${i} ` }
        await sleep(100)
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'slow done' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    for (const word of ['Hello ', 'from ', 'dsh ', 'in-process!']) {
      yield { type: 'text-delta', index: 0, text: word }
    }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello from dsh in-process!' } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 4 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  providerInfo(provider) { return { id: provider, name: 'Mock Provider' } }
  async listModels(provider) { return [{ provider, id: 'mock-1', name: 'Mock One' }] }
  async resolveModel(provider, model) {
    return { provider, id: model, name: 'Mock One', context: { contextWindow: 128000 } }
  }
}

// ---------- boot ----------
const ctx = new Context()
ctx.plugin(Timer)
ctx.plugin(LlmRuntime)
ctx.plugin(SessionStore)
ctx.plugin(SystemPrompt, { includeHarnessIdentity: true, includeRuntimeContext: true, persona: 'You are a spike test agent.' })
ctx.plugin(ToolRuntime, {})
ctx.plugin(AgentRegistry)
ctx.plugin(ApprovalService, { policy: 'ask' })
ctx.plugin(AgentLoop, { agents: [] })

// The "SuperOne bridge plugin": activates when the services it injects exist.
const ready = new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('bridge plugin never activated — services missing')), 5000)
  ctx.plugin({
    name: 'superone-bridge-spike',
    inject: ['agents', 'llm', 'tools', 'sessions'],
    apply(bridgeCtx) {
      clearTimeout(t)
      resolve(bridgeCtx)
    },
  })
})

const bridge = await ready
log('E2', 'bridge plugin activated: in-process composition works')

// ---------- event tap (what SuperOne's AgentEvent mapper would consume) ----------
const events = []
bridge.on('session/event', (session, event) => {
  events.push(event)
  const brief =
    event.type === 'assistant/chunk' ? JSON.stringify(event.data.chunk).slice(0, 80)
    : event.type === 'user/message' ? JSON.stringify(event.data.content).slice(0, 60)
    : JSON.stringify(event.data).slice(0, 100)
  log('event', `#${event.seq}`, event.type, brief)
})
bridge.on('agent/status', ({ agent, status }) => log('status', String(agent.id).slice(0, 8), status))

// approval answerer (SuperOne permission popover stand-in)
let approvalAsked = false
bridge.on('approval/request', async (request) => {
  approvalAsked = true
  log('E4', `approval/request tool=${request.toolName} callId=${request.callId} reason=${request.reason}`)
  await sleep(50) // simulate the user clicking Allow
  return 'allowed-once'
})

// guard: ping requires approval
bridge.on('tools/pre-execute', async (exec, next) => {
  if (exec.name === 'ping') return { kind: 'ask', reason: 'spike wants approval' }
  return next()
})

// custom tool
let toolRan = false
bridge.tools.register({
  name: 'ping',
  description: 'Reply pong.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value) }],
  },
  async execute() {
    toolRan = true
    return 'pong'
  },
})

// mock adapter on route 'mock'
const adapter = new MockAdapter()
bridge.llm.registerAdapter(['mock'], adapter)

// ---------- helpers ----------
function waitTurnEnd() {
  return new Promise((resolve) => {
    const dispose = bridge.on('session/event', (_s, event) => {
      if (event.type === 'turn/end') { dispose(); resolve(event.data) }
    })
  })
}

// ---------- E2: plain text turn ----------
const handle = await bridge.agents.create({
  sessionId: SessionId(randomUUID()),
  meta: { cwd: process.cwd() },
  agentOptions: { provider: 'mock', model: 'mock-1' },
})
const agent = handle.agent
log('E2', 'agent created', agent.id)

let end = waitTurnEnd()
agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi there' }], source: { kind: 'user' } }))
log('E2', 'turn ended:', JSON.stringify(await end))
await agent.whenIdle()

// ---------- E3 + E4: tool call with approval ----------
end = waitTurnEnd()
agent.followup(createUserMessage({ content: [{ type: 'text', text: 'please TOOL now' }], source: { kind: 'user' } }))
let firstEnd = await end
await agent.whenIdle()
// the tool-calls turn continues into a second step; wait for final stop
if (events.filter((e) => e.type === 'tool/result').length === 0) {
  await waitTurnEnd()
}
await sleep(100)
log('E3/E4', `toolRan=${toolRan} approvalAsked=${approvalAsked} firstTurnEnd=${JSON.stringify(firstEnd)}`)

// ---------- E5a: mid-turn cancel ----------
end = waitTurnEnd()
agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go SLOW' }], source: { kind: 'user' } }))
await sleep(350) // let a few slow deltas stream
agent.cancel({ kind: 'user' })
log('E5a', 'cancel issued; turn ended:', JSON.stringify(await end))
await agent.whenIdle()

// ---------- E5b: runtime hot mount/unmount ----------
const fiber = bridge.plugin({
  name: 'extra-tool',
  inject: ['tools'],
  apply(c) {
    c.tools.register({
      name: 'extra',
      description: 'hot-mounted tool',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
      async execute() { return 'extra!' },
    })
  },
})
await sleep(100)
end = waitTurnEnd()
agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi again' }], source: { kind: 'user' } }))
await end
await agent.whenIdle()
const withExtra = [...adapter.lastSeenTools]
await fiber.dispose()
await sleep(100)
end = waitTurnEnd()
agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi once more' }], source: { kind: 'user' } }))
await end
await agent.whenIdle()
const withoutExtra = [...adapter.lastSeenTools]
log('E5b', `tools with hot plugin: [${withExtra}] | after dispose: [${withoutExtra}]`)

// ---------- summary ----------
const counts = {}
for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1
log('summary', JSON.stringify(counts))
await handle.dispose()
process.exit(0)
