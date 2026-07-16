import { createRequire } from 'node:module'
import { CodexResponsesTransformer } from './codex-responses/transformer'

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

const server = new Server({ initialConfig: cfg as Record<string, unknown> })
await server.transformerService.initialize()
server.transformerService.removeTransformer('openai-responses')

for (const endpoint of ['/responses', '/v1/responses', '/responses/compact']) {
  const t = new CodexResponsesTransformer()
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
