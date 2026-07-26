import { createRequire } from 'node:module'
import { trace, traceReady } from '../agent/event-trace'
import { CodexResponsesTransformer } from './codex-responses/transformer'
import type { CodexChatReasoningConfig } from './codex-responses/reasoning'
import { normalizeAdaptiveThinkingRequest, OpenAiNormalizedTrace, OpenAiReasoningDiagnostic } from './openai-reasoning-diagnostic'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require('@musistudio/llms')
const Server = mod.default ?? mod

const cfgRaw = process.env.SUPERONE_PROXY_CONFIG
if (!cfgRaw) {
  process.stderr.write('[llm-proxy-entry] SUPERONE_PROXY_CONFIG env not set\n')
  process.exit(1)
}

let cfg: Record<string, unknown>
try {
  cfg = JSON.parse(cfgRaw)
} catch {
  process.stderr.write('[llm-proxy-entry] invalid SUPERONE_PROXY_CONFIG JSON\n')
  process.exit(1)
}

// Naming is done via spawn-time `argv0` in llm-proxy-manager.ts, not `process.title`
// here — see the comment in process-titles.ts for why (Dock-bounce risk on macOS).

// This sidecar is forked without a process-group link to the main process, so a
// crashed or SIGKILL'd parent used to leave it running indefinitely (observed:
// several 3-day-old orphans from dev runs). The IPC channel is torn down by the
// kernel the moment the parent's fds are reclaimed, so treat it as a quit signal.
process.on('disconnect', () => process.exit(0))

const reasoningConfig = cfg.superoneReasoningConfig as CodexChatReasoningConfig | undefined

const server = new Server({ initialConfig: cfg as Record<string, unknown> })
await server.transformerService.initialize()
await traceReady
server.transformerService.removeTransformer('openai-responses')

for (let attempts = 0; !server.providerService && attempts < 20; attempts++) {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
if (!server.providerService) throw new Error('llm proxy provider service did not initialize')

for (const provider of server.providerService.getProviders()) {
  const transformer = provider.transformer ?? (provider.transformer = {})
  const use = transformer.use ?? (transformer.use = [])
  if (!use.some((item: { name?: string }) => item?.name === 'superone-normalized-trace')) {
    use.unshift(new OpenAiNormalizedTrace())
  }
  if (!use.some((item: { name?: string }) => item?.name === 'superone-reasoning-diagnostic')) {
    use.push(new OpenAiReasoningDiagnostic())
  }
}

for (const endpoint of ['/responses', '/v1/responses', '/responses/compact']) {
  const t = new CodexResponsesTransformer(reasoningConfig)
  t.endPoint = endpoint
  server.transformerService.registerTransformer(`codex-responses-${endpoint.replace(/\//g, '-')}`, t)
}

const providers = (cfg.providers as Array<Record<string, unknown>> | undefined) ?? []
const providerModels: string[] = []
for (const p of providers) {
  if (Array.isArray(p.models)) providerModels.push(...(p.models as string[]))
}
type ReplyLike = { send: (payload: unknown) => void }
const codexModelList = { models: [] as unknown[] }
server.app.get('/models', async (_req: unknown, reply: ReplyLike) => { void reply.send(codexModelList) })
const openAiModelList = { object: 'list', data: providerModels.map((id) => ({ id, object: 'model' })) }
server.app.get('/v1/models', async (_req: unknown, reply: ReplyLike) => { void reply.send(openAiModelList) })

server.app.addHook('preValidation', async (req: { id?: string; method: string; body?: unknown }) => {
  if (req.method === 'POST') trace('llm-proxy.in', 'raw_request', req.body, req.id)
  normalizeAdaptiveThinkingRequest(req.body)
})

const codexProviderName = typeof providers[0]?.name === 'string' ? (providers[0].name as string) : undefined
if (codexProviderName) {
  server.app.addHook('preValidation', async (req: { method: string; url: string; body?: unknown }) => {
    const path = req.url.split('?')[0]
    if (req.method !== 'POST' || !path.includes('/responses')) return
    const body = req.body as { model?: unknown } | undefined
    if (body && typeof body.model === 'string' && body.model && !body.model.includes(',')) {
      body.model = `${codexProviderName},${body.model}`
    }
  })
}

await server.start()

process.send?.({ type: 'listening' })
