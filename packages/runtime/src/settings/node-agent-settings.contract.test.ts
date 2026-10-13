import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { NodeAgentSettings, NodeAgentSettingsPatch } from '@superone/shared/environment'
import { DEFAULT_NODE_AGENT_SETTINGS, loadNodeAgentSettings, patchNodeAgentSettings, resolveAgentTurnDefaults } from './node-agent-settings'

const samples = {
  claude: { defaultModel: 'claude-sonnet-4-6', defaultEffort: 'high', permissionMode: 'acceptEdits',
    sandboxMode: 'auto', disabledSkills: ['contract-skill'], askUserQuestionPreviewFormat: 'html' },
  codex: { defaultModel: 'gpt-6.1-sol', defaultEffort: 'ultra', permissionPreset: 'full-access' },
  experimentalClaudeOpenAiChatEnabled: true, projectsDir: '/tmp/contract-projects',
} satisfies Required<NodeAgentSettings>
const turnConsumers = {
  defaultModel: 'model', defaultEffort: 'effort', permissionMode: 'permissionMode',
  sandboxMode: 'sandboxMode', disabledSkills: 'disabledSkills', permissionPreset: 'permissionPreset',
  askUserQuestionPreviewFormat: 'node-local',
} satisfies Record<keyof NodeAgentSettings['claude'] | keyof NodeAgentSettings['codex'], keyof ReturnType<typeof resolveAgentTurnDefaults> | 'node-local'>
const cases = Object.entries(samples).flatMap<{ path: string; value: unknown; patch: NodeAgentSettingsPatch }>(([key, value]) => typeof value === 'object'
  ? Object.entries(value).map(([child, next]) => ({ path: `${key}.${child}`, value: next, patch: { [key]: { [child]: next } } }))
  : [{ path: key, value, patch: { [key]: value } }])
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function config() {
  const dir = mkdtempSync(join(tmpdir(), 'node-settings-contract-'))
  dirs.push(dir)
  const path = join(dir, 'config.json')
  writeFileSync(path, JSON.stringify({ unrelated: { retained: true } }))
  return path
}
function readPath(settings: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], settings)
}

describe('all node-global agent settings', () => {
  it('requires samples for every default and per-harness field', () => {
    expect(Object.keys(samples).sort()).toEqual(Object.keys(DEFAULT_NODE_AGENT_SETTINGS).sort())
    for (const harness of ['claude', 'codex'] as const) {
      expect(Object.keys(samples[harness]).sort()).toEqual(Object.keys(DEFAULT_NODE_AGENT_SETTINGS[harness]).sort())
    }
  })

  it.each(cases)('preserves $path across patch response, fresh read and unrelated writes', ({ path, patch, value }) => {
    const file = config()
    const saved = patchNodeAgentSettings(file, patch as NodeAgentSettingsPatch)
    expect(readPath(saved, path)).toEqual(value)
    expect(readPath(loadNodeAgentSettings(file), path)).toEqual(value)
    const [harness, key] = path.split('.')
    const consumer = turnConsumers[key as keyof typeof turnConsumers]
    if (consumer && consumer !== 'node-local') {
      expect(resolveAgentTurnDefaults(loadNodeAgentSettings(file), harness)[consumer]).toEqual(value)
    }
    patchNodeAgentSettings(file, path === 'projectsDir' ? { experimentalClaudeOpenAiChatEnabled: false } : { projectsDir: '/tmp/other-projects' })
    expect(readPath(loadNodeAgentSettings(file), path)).toEqual(value)
    expect(JSON.parse(readFileSync(file, 'utf8')).unrelated).toEqual({ retained: true })
  })

  it.each(['', 'read-only', 'default', 'auto-review', 'full-access'] as const)
    ('keeps the public Codex permission default %s through persistence and turn fallback', (preset) => {
      const file = config()
      const saved = patchNodeAgentSettings(file, { codex: { permissionPreset: preset } })
      expect.soft(saved.codex.permissionPreset).toBe(preset)
      const restored = loadNodeAgentSettings(file)
      expect.soft(restored.codex.permissionPreset).toBe(preset)
      expect.soft(resolveAgentTurnDefaults(restored, 'codex').permissionPreset).toBe(preset || undefined)
    })
})
