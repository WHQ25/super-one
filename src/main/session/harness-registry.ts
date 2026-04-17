import { z } from 'zod'
import type { Harness, HarnessId, SessionBackend } from './types'

const claudeConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  extraEnv: z.record(z.string(), z.string()).optional(),
  initializeTimeoutMs: z.number().positive().optional(),
}).passthrough()

const codexConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  extraEnv: z.record(z.string(), z.string()).optional(),
  initializeTimeoutMs: z.number().positive().optional(),
}).passthrough()

function notImplemented(harnessId: HarnessId): () => SessionBackend {
  return () => { throw new Error(`[harness:${harnessId}] createBackend not implemented yet`) }
}

const claudeHarness: Harness = {
  id: 'claude',
  name: 'Claude (Anthropic)',
  configSchema: claudeConfigSchema,
  createBackend: notImplemented('claude'),
}

const codexHarness: Harness = {
  id: 'codex',
  name: 'Codex (OpenAI)',
  configSchema: codexConfigSchema,
  createBackend: notImplemented('codex'),
}

const registry = new Map<HarnessId, Harness>([
  ['claude', claudeHarness],
  ['codex', codexHarness],
])

export const harnessRegistry = {
  get(id: HarnessId): Harness | undefined {
    return registry.get(id)
  },
  list(): Harness[] {
    return Array.from(registry.values())
  },
}
