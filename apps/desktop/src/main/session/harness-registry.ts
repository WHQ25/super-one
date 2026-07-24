import { z } from 'zod'
import { AcpBackend } from './backends/acp-backend'
import { ClaudeBackend } from './backends/claude-backend'
import { CodexBackend } from './backends/codex-backend'
import { OpenCodeBackend } from './backends/opencode-backend'
import { forkAcpTranscript } from './backends/acp-fork'
import { forkClaudeTranscript } from './backends/claude-fork'
import { forkCodexThread } from './backends/codex-fork'
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
  permissionPreset: z.enum(['read-only', 'default', 'full-access']).optional(),
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
}).passthrough()

const acpConfigSchema = z.object({
  agentId: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
}).passthrough()

const openCodeConfigSchema = z.object({
  binaryPath: z.string().optional(),
  serverUrl: z.string().url().optional(),
  serverPassword: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  startupTimeoutMs: z.number().positive().optional(),
}).passthrough()

const claudeHarness: Harness = {
  id: 'claude',
  name: 'Claude (Anthropic)',
  configSchema: claudeConfigSchema,
  createBackend: () => new ClaudeBackend(),
  forkTranscript: forkClaudeTranscript,
}

const codexHarness: Harness = {
  id: 'codex',
  name: 'Codex (OpenAI)',
  configSchema: codexConfigSchema,
  createBackend: () => new CodexBackend(),
  forkTranscript: forkCodexThread,
}

const acpHarness: Harness = {
  id: 'acp',
  name: 'Others (ACP)',
  configSchema: acpConfigSchema,
  createBackend: () => new AcpBackend(),
  forkTranscript: forkAcpTranscript,
}

const openCodeHarness: Harness = {
  id: 'opencode',
  name: 'OpenCode',
  configSchema: openCodeConfigSchema,
  createBackend: () => new OpenCodeBackend(),
  forkTranscript: async (source, targetCwd) => {
    throw new Error(`OpenCode transcript fork is not supported yet (${source.providerSessionId} -> ${targetCwd})`)
  },
}

const registry = new Map<HarnessId, Harness>([
  ['claude', claudeHarness],
  ['codex', codexHarness],
  ['acp', acpHarness],
  ['opencode', openCodeHarness],
])

export const harnessRegistry = {
  get(id: HarnessId): Harness | undefined {
    return registry.get(id)
  },
  list(): Harness[] {
    return Array.from(registry.values())
  },
}
