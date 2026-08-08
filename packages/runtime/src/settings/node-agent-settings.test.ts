import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DEFAULT_NODE_AGENT_SETTINGS,
  loadNodeAgentSettings,
  mergeNodeAgentSettings,
  patchNodeAgentSettings,
  resolveAgentTurnDefaults,
  saveNodeAgentSettings,
} from './node-agent-settings'

describe('node-agent-settings', () => {
  it('loads defaults when config is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nas-'))
    const path = join(dir, 'config.json')
    try {
      expect(loadNodeAgentSettings(path)).toEqual({
        ...DEFAULT_NODE_AGENT_SETTINGS,
        claude: { ...DEFAULT_NODE_AGENT_SETTINGS.claude, disabledSkills: [] },
        codex: { ...DEFAULT_NODE_AGENT_SETTINGS.codex },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('patches claude.defaultModel and persists under agent key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nas-'))
    const path = join(dir, 'config.json')
    try {
      const settings = patchNodeAgentSettings(path, {
        claude: { defaultModel: 'claude-sonnet-4-5' },
      })
      expect(settings.claude.defaultModel).toBe('claude-sonnet-4-5')
      const file = JSON.parse(readFileSync(path, 'utf8')) as {
        agent: { claude: { defaultModel: string } }
      }
      expect(file.agent.claude.defaultModel).toBe('claude-sonnet-4-5')
      expect(loadNodeAgentSettings(path).claude.defaultModel).toBe('claude-sonnet-4-5')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('merges patch without clobbering sibling fields', () => {
    const base = mergeNodeAgentSettings(DEFAULT_NODE_AGENT_SETTINGS, {
      claude: { defaultModel: 'm1', permissionMode: 'plan' },
      experimentalAgentCollaborationEnabled: true,
      experimentalClaudeOpenAiChatEnabled: true,
    })
    const next = mergeNodeAgentSettings(base, {
      claude: { defaultEffort: 'high' },
    })
    expect(next.claude.defaultModel).toBe('m1')
    expect(next.claude.permissionMode).toBe('plan')
    expect(next.claude.defaultEffort).toBe('high')
    expect(next.experimentalAgentCollaborationEnabled).toBe(true)
    expect(next.experimentalClaudeOpenAiChatEnabled).toBe(true)
  })

  it('resolveAgentTurnDefaults maps claude defaults for send fallback', () => {
    const settings = saveNodeAgentSettings(join(mkdtempSync(join(tmpdir(), 'nas-')), 'c.json'), {
      ...DEFAULT_NODE_AGENT_SETTINGS,
      claude: {
        defaultModel: 'claude-opus-4',
        defaultEffort: 'high',
        permissionMode: 'acceptEdits',
        sandboxMode: 'auto',
        disabledSkills: ['x'],
      },
      codex: { ...DEFAULT_NODE_AGENT_SETTINGS.codex },
    })
    expect(resolveAgentTurnDefaults(settings, 'claude')).toEqual({
      model: 'claude-opus-4',
      effort: 'high',
      permissionMode: 'acceptEdits',
      sandboxMode: 'auto',
      disabledSkills: ['x'],
    })
  })
})
