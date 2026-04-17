import { z } from 'zod'
import { ClaudeBackend } from './backends/claude-backend'
import { CodexBackend } from './backends/codex-backend'
import type { Harness, HarnessId } from './types'

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
  permissionPreset: z.enum(['default', 'full-access']).optional(),
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
}).passthrough()

const claudeHarness: Harness = {
  id: 'claude',
  name: 'Claude (Anthropic)',
  configSchema: claudeConfigSchema,
  createBackend: () => new ClaudeBackend(),
}

const codexHarness: Harness = {
  id: 'codex',
  name: 'Codex (OpenAI)',
  configSchema: codexConfigSchema,
  createBackend: () => new CodexBackend(),
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
