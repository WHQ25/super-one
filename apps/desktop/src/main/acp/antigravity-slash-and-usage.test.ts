import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { AgentEvent } from '@superone/shared/agent-types'
import { mapSessionUpdate } from './acp-event-map'
import { createXaiCorrelationState } from './acp-xai-session-notify'
import { ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE } from './antigravity-auto-bootstrap'
import { extractAntigravityTurnUsageAndThinking } from './antigravity-db-usage'
import {
  advanceAntigravityThinkingStepAfterTools,
  closeAntigravityThinkingStep,
  extractAntigravityPromptResponseUsage,
  extractAntigravityWireTurnUsage,
  finalizeAntigravityTurnThinking,
  openAntigravityThinkingStep,
  stampAntigravityThoughtDeltas,
  syncAntigravityTurnFromDb,
  type AntigravityTurnThinkingScope,
} from './antigravity-runtime-bridge'
import {
  discoverAntigravitySlashCommands,
  parseSkillFrontmatter,
} from './antigravity-slash-commands'

describe('antigravity slash commands and skills', () => {
  it('compiles ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE without Python syntax errors and supports 1.4.5 symbols', () => {
    expect(() =>
      execFileSync(
        'python3',
        ['-c', 'import sys; compile(sys.stdin.read(), "sitecustomize.py", "exec")'],
        { input: ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE },
      ),
    ).not.toThrow()
    expect(ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE).toContain('getattr(sdk_types, "GeminiModelOptions", None)')
    expect(ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE).toContain('getattr(terminal_sandbox_mod, "os_sandbox_supported", None)')
    expect(ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE).toContain('server_mod.acp_paths.gemini_home()')
    expect(ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE).toContain('_extract_tool_display_title')
  })

  it('parses single-line and multiline YAML skill frontmatter and respects disable-slash-command', () => {
    const multiline = `---
name: agy-customizations
description: >-
  Comprehensive guide and reference for the Antigravity Customization System.
  Use to explain how customizations work.
argument-hint: "[topic]"
---
# AGY Customizations
`
    expect(parseSkillFrontmatter(multiline)).toEqual({
      name: 'agy-customizations',
      description:
        'Comprehensive guide and reference for the Antigravity Customization System. Use to explain how customizations work.',
      'argument-hint': '[topic]',
    })

    const disabled = `---
name: hidden-skill
description: Hidden skill
disable-slash-command: true
---
`
    expect(parseSkillFrontmatter(disabled)['disable-slash-command']).toBe('true')
  })

  it('discovers built-in slash commands plus workspace, user, plugin, and CLI builtin skills', () => {
    const root = mkdtempSync(join(tmpdir(), 'agy-skills-test-'))
    try {
      const workspaceDir = join(root, 'workspace')
      const homeDir = join(root, 'home')
      mkdirSync(join(workspaceDir, '.git'), { recursive: true })
      mkdirSync(join(workspaceDir, '.agents', 'skills', 'superone-tool'), { recursive: true })
      writeFileSync(
        join(workspaceDir, '.agents', 'skills', 'superone-tool', 'SKILL.md'),
        '---\nname: superone-tool\ndescription: Design or change SuperOne agent tools.\n---\n',
      )
      mkdirSync(join(homeDir, '.gemini', 'config', 'plugins', 'chrome-devtools-plugin', 'skills', 'chrome-devtools'), {
        recursive: true,
      })
      writeFileSync(
        join(
          homeDir,
          '.gemini',
          'config',
          'plugins',
          'chrome-devtools-plugin',
          'skills',
          'chrome-devtools',
          'SKILL.md',
        ),
        '---\nname: chrome-devtools\ndescription: Uses Chrome DevTools via MCP.\n---\n',
      )
      mkdirSync(join(homeDir, '.gemini', 'antigravity-cli', 'builtin', 'skills', 'antigravity_guide'), {
        recursive: true,
      })
      writeFileSync(
        join(homeDir, '.gemini', 'antigravity-cli', 'builtin', 'skills', 'antigravity_guide', 'SKILL.md'),
        '---\nname: antigravity-guide\ndescription: Guide for Google Antigravity.\n---\n',
      )

      const commands = discoverAntigravitySlashCommands({ cwd: workspaceDir, homeDir })
      const names = commands.map((c) => c.name)
      expect(names).toEqual(
        expect.arrayContaining([
          'plan',
          'compact',
          'goal',
          'schedule',
          'browser',
          'grill-me',
          'teamwork',
          'learn',
          'boost',
          'usage',
          'logout',
          'superone-tool',
          'chrome-devtools',
          'antigravity-guide',
        ]),
      )

      const skillEntry = commands.find((c) => c.name === 'superone-tool')
      expect(skillEntry?.isSkill).toBe(true)
      const builtinEntry = commands.find((c) => c.name === 'plan')
      expect(builtinEntry?.isSkill).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('maps available_commands_update with _meta.isSkill and usage_update with _meta.antigravityTurnUsage', () => {
    const cmdEvents = mapSessionUpdate(
      {
        sessionUpdate: 'available_commands_update',
        availableCommands: [
          { name: 'plan', description: 'Plan mode' },
          {
            name: 'superone-harness',
            description: 'Harness skill',
            _meta: { path: '/repo/.agents/skills/superone-harness/SKILL.md', isSkill: true },
          },
        ],
      } as unknown as SessionUpdate,
      { messageId: 'm1' },
    )
    expect(cmdEvents).toEqual([
      {
        type: 'acp_commands',
        commands: [
          { name: 'plan', description: 'Plan mode', argumentHint: '', isSkill: false },
          { name: 'superone-harness', description: 'Harness skill', argumentHint: '', isSkill: true },
        ],
      },
    ])

    const usageEvents = mapSessionUpdate(
      {
        sessionUpdate: 'usage_update',
        used: 24500,
        size: 1000000,
        _meta: {
          antigravityTurnUsage: {
            inputTokens: 18000,
            outputTokens: 650,
            cacheReadTokens: 5850,
            thoughtsTokens: 200,
            contextTokens: 24500,
            contextWindow: 1000000,
            model: 'gemini-3.1-pro-high',
          },
        },
      } as unknown as SessionUpdate,
      { messageId: 'm1' },
    )
    expect(usageEvents).toEqual([
      {
        type: 'message_usage',
        messageId: 'm1',
        inputTokens: 18000,
        outputTokens: 650,
        cacheReadTokens: 5850,
        contextTokens: 24500,
        contextWindow: 1000000,
        model: 'gemini-3.1-pro-high',
      },
    ])
  })
})

describe('antigravity per-turn real-time and 1.4.5 SQLite token usage', () => {
  it('extracts turn usage from 1.4.5 (idx, step_payload) SQLite schema and merges wire + PromptResponse usage', () => {
    const root = mkdtempSync(join(tmpdir(), 'agy-db-145-'))
    try {
      const sessionId = 'sess_145'
      const convDir = join(root, 'antigravity', 'profile', 'antigravity-acp', 'conversations')
      mkdirSync(convDir, { recursive: true })
      const dbPath = join(convDir, `${sessionId}.db`)
      const db = new Database(dbPath)
      db.exec('CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_payload BLOB NOT NULL)')

      const encodeLen = (field: number, bytes: Uint8Array): Buffer => {
        const tag = (field << 3) | 2
        const lenBytes: number[] = []
        let v = bytes.length
        while (v >= 0x80) {
          lenBytes.push((v & 0x7f) | 0x80)
          v >>>= 7
        }
        lenBytes.push(v)
        return Buffer.concat([Buffer.from([tag, ...lenBytes]), Buffer.from(bytes)])
      }

      const userStepPayload = encodeLen(14, Buffer.from([0x0a, 0x05, ...Buffer.from('hello')]))
      const metadataHex =
        '0a0b088be9d7ce0610c8de9725320b088de9d7ce0610f89eb24b420b088de9d7ce061088ac884d4a2b0a154d4f44454c5f504c414345484f4c4445525f4d333710918401181f22083a060801109184014847501fc2011d084720c0843d2a00421367656d696e692d332e312d70726f2d68696768'
      const innerPlanner = Buffer.concat([
        encodeLen(1, Buffer.from('Done')),
        encodeLen(3, Buffer.from('\n\nThinking deeply\n\n\nSecond paragraph\n\n\n')),
        encodeLen(11, Buffer.from([0x08, 0x02])),
      ])
      const plannerStepPayload = Buffer.concat([
        encodeLen(1, Buffer.from(metadataHex, 'hex')),
        Buffer.from([0xa2, 0x01, innerPlanner.length]),
        innerPlanner,
      ])

      const insert = db.prepare('INSERT INTO steps (idx, step_payload) VALUES (?, ?)')
      insert.run(0, userStepPayload)
      insert.run(1, plannerStepPayload)
      db.close()

      const summary = extractAntigravityTurnUsageAndThinking(sessionId, root)
      expect(summary).not.toBeNull()
      expect(summary?.inputTokens).toBe(16913)
      expect(summary?.outputTokens).toBe(102)
      expect(summary?.contextWindow).toBe(1000000)
      expect(summary?.model).toBe('gemini-3.1-pro-high')
      expect(summary?.thinkingSteps).toHaveLength(1)
      expect(summary?.thinkingSteps[0]?.thinkingText).toBe('Thinking deeply\n\nSecond paragraph')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }

    const wireUsage = extractAntigravityWireTurnUsage({
      sessionUpdate: 'usage_update',
      used: 22000,
      size: 1048576,
      _meta: {
        antigravityTurnUsage: {
          inputTokens: 15000,
          outputTokens: 420,
          cacheReadTokens: 6580,
          thoughtsTokens: 120,
          contextTokens: 22000,
          contextWindow: 1048576,
          model: 'gemini-3.1-pro-high',
        },
      },
    })
    expect(wireUsage).toEqual({
      inputTokens: 15000,
      outputTokens: 420,
      cacheReadTokens: 6580,
      thoughtsTokens: 120,
      contextTokens: 22000,
      contextWindow: 1048576,
      model: 'gemini-3.1-pro-high',
    })

    const promptUsage = extractAntigravityPromptResponseUsage({
      stopReason: 'end_turn',
      usage: {
        inputTokens: 31000,
        outputTokens: 500,
        thoughtTokens: 300,
        cachedReadTokens: 12000,
        totalTokens: 31800,
      },
    })
    expect(promptUsage).toEqual({
      inputTokens: 19000,
      outputTokens: 800,
      cacheReadTokens: 12000,
      thoughtsTokens: 300,
      contextTokens: 0,
      contextWindow: 0,
      model: '',
    })

    const events: AgentEvent[] = []
    const scope: AntigravityTurnThinkingScope = {
      sawAgentThoughtChunk: true,
      stepIndex: 0,
      stepStartedAt: 1000,
      currentStepHasThinking: false,
      currentStepThinkingClosed: false,
      currentStepHasThoughtText: false,
      emittedStepThinkingIds: [],
    }
    const corr = createXaiCorrelationState()
    const synced = syncAntigravityTurnFromDb(
      'nonexistent-session',
      'msg_live',
      scope,
      corr,
      (ev) => events.push(ev),
      false,
      wireUsage,
    )
    expect(synced).toBe(true)
    expect(events.at(-1)).toEqual({
      type: 'message_usage',
      messageId: 'msg_live',
      inputTokens: 15000,
      outputTokens: 420,
      cacheReadTokens: 6580,
      contextTokens: 22000,
      contextWindow: 1048576,
      model: 'gemini-3.1-pro-high',
    })

    finalizeAntigravityTurnThinking(
      'nonexistent-session',
      'msg_live',
      scope,
      corr,
      (ev) => events.push(ev),
      promptUsage,
    )
    expect(events.at(-1)).toEqual({
      type: 'message_usage',
      messageId: 'msg_live',
      inputTokens: 19000,
      outputTokens: 800,
      cacheReadTokens: 12000,
      contextTokens: 22000,
      contextWindow: 1048576,
      model: 'gemini-3.1-pro-high',
    })

    const thoughtScope: AntigravityTurnThinkingScope = {
      sawAgentThoughtChunk: false,
      stepIndex: 0,
      stepStartedAt: 1000,
      currentStepHasThinking: false,
      currentStepThinkingClosed: false,
      currentStepHasThoughtText: false,
      emittedStepThinkingIds: [],
    }
    const streamedEvents: AgentEvent[] = []
    openAntigravityThinkingStep(thoughtScope, 'msg_live', (ev) => streamedEvents.push(ev))
    const c1 = mapSessionUpdate(
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '\n\nFirst paragraph.\n\n\n' } } as SessionUpdate,
      { messageId: 'msg_live' },
    )
    stampAntigravityThoughtDeltas(thoughtScope, c1)
    const c2 = mapSessionUpdate(
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Second paragraph.\n\n\n' } } as SessionUpdate,
      { messageId: 'msg_live' },
    )
    stampAntigravityThoughtDeltas(thoughtScope, c2)
    closeAntigravityThinkingStep(thoughtScope, 'msg_live', (ev) => streamedEvents.push(ev))
    const combinedThinking = [...c1, ...c2]
      .filter((ev): ev is Extract<AgentEvent, { type: 'content_delta' }> => ev.type === 'content_delta')
      .map((ev) => (ev.delta.type === 'thinking' ? ev.delta.thinking : ''))
      .join('')
    expect(combinedThinking).toBe('First paragraph.\n\nSecond paragraph.')
  })

  it('computes uncached input tokens across multi-step turn in SQLite without duplicating cache reads', () => {
    const root = mkdtempSync(join(tmpdir(), 'agy-multistep-'))
    try {
      const sessionId = 'sess_multi'
      const convDir = join(root, 'antigravity', 'profile', 'antigravity-acp', 'conversations')
      mkdirSync(convDir, { recursive: true })
      const dbPath = join(convDir, `${sessionId}.db`)
      const db = new Database(dbPath)
      db.exec('CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_payload BLOB NOT NULL)')

      const encodeLen = (field: number, bytes: Uint8Array): Buffer => {
        const tag = (field << 3) | 2
        const lenBytes: number[] = []
        let v = bytes.length
        while (v >= 0x80) {
          lenBytes.push((v & 0x7f) | 0x80)
          v >>>= 7
        }
        lenBytes.push(v)
        return Buffer.concat([Buffer.from([tag, ...lenBytes]), Buffer.from(bytes)])
      }

      const encodeVarint = (field: number, val: number): Buffer => {
        const tag = (field << 3) | 0
        const bytes = [tag]
        let v = val
        while (v >= 0x80) {
          bytes.push((v & 0x7f) | 0x80)
          v >>>= 7
        }
        bytes.push(v)
        return Buffer.from(bytes)
      }

      const userStepPayload = encodeLen(14, Buffer.from([0x0a, 0x05, ...Buffer.from('hello')]))

      const buildMeta = (inputTokens: number, outputTokens: number, cacheReadTokens: number, thoughtsTokens: number): Buffer => {
        const stats = Buffer.concat([
          encodeLen(1, Buffer.from('gemini-3.1-pro-high')),
          encodeVarint(2, inputTokens),
          encodeVarint(3, outputTokens),
          encodeVarint(8, cacheReadTokens),
          encodeVarint(9, thoughtsTokens),
        ])
        return encodeLen(9, stats)
      }

      // Step 1: 20000 total prompt, 19000 cached -> 1000 uncached upload. Output: 50 + 20 thoughts
      const meta1 = buildMeta(20000, 50, 19000, 20)
      const planner1 = Buffer.concat([
        encodeLen(1, Buffer.from('Calling tool')),
        encodeLen(3, Buffer.from('thinking step 1')),
      ])
      const step1Payload = Buffer.concat([
        encodeLen(1, meta1),
        Buffer.from([0xa2, 0x01, planner1.length]),
        planner1,
      ])

      // Step 2: 20250 total prompt, 20050 cached -> 200 uncached upload. Output: 80 + 0 thoughts
      const meta2 = buildMeta(20250, 80, 20050, 0)
      const planner2 = Buffer.concat([
        encodeLen(1, Buffer.from('Final answer')),
      ])
      const step2Payload = Buffer.concat([
        encodeLen(1, meta2),
        Buffer.from([0xa2, 0x01, planner2.length]),
        planner2,
      ])

      const insert = db.prepare('INSERT INTO steps (idx, step_payload) VALUES (?, ?)')
      insert.run(0, userStepPayload)
      insert.run(1, step1Payload)
      insert.run(2, step2Payload)
      db.close()

      const summary = extractAntigravityTurnUsageAndThinking(sessionId, root)
      expect(summary).not.toBeNull()
      // inputTokens is sum of UNCACHED tokens: (20000 - 19000) + (20250 - 20050) = 1000 + 200 = 1200
      expect(summary?.inputTokens).toBe(1200)
      // outputTokens: (50 + 20) + (80 + 0) = 150
      expect(summary?.outputTokens).toBe(150)
      // cacheReadTokens: 19000 + 20050 = 39050
      expect(summary?.cacheReadTokens).toBe(39050)
      // contextTokens is the occupancy after the final step: 20250 + 80 = 20330
      expect(summary?.contextTokens).toBe(20330)
      // thinkingSteps only contains steps with actual text (step 1 has text, step 2 has none)
      expect(summary?.thinkingSteps).toHaveLength(1)
      expect(summary?.thinkingSteps[0]?.thinkingText).toBe('thinking step 1')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not eagerly open thinking on advanceAntigravityThinkingStepAfterTools and retracts empty thinking', () => {
    const scope: AntigravityTurnThinkingScope = {
      sawAgentThoughtChunk: false,
      stepIndex: 0,
      stepStartedAt: 1000,
      currentStepHasThinking: false,
      currentStepThinkingClosed: false,
      currentStepHasThoughtText: false,
      emittedStepThinkingIds: [],
    }
    const events: AgentEvent[] = []
    const emit = (ev: AgentEvent) => events.push(ev)
    const corr = createXaiCorrelationState()

    // 1. Advance after tool: does NOT emit thinking content_delta
    advanceAntigravityThinkingStepAfterTools('nonexistent', 'm1', scope, corr, emit)
    expect(scope.stepIndex).toBe(1)
    expect(scope.currentStepHasThinking).toBe(false)
    expect(events.filter((e) => e.type === 'content_delta')).toHaveLength(0)

    // 2. Open thinking step but no thought chunks arrive
    openAntigravityThinkingStep(scope, 'm1', emit)
    expect(scope.currentStepHasThinking).toBe(true)
    expect(events.some((e) => e.type === 'content_delta' && e.delta.type === 'thinking')).toBe(true)

    // 3. closeAntigravityThinkingStep without thought text retracts the block
    closeAntigravityThinkingStep(scope, 'm1', emit)
    expect(events.some((e) => e.type === 'content_retracted')).toBe(true)
    expect(scope.currentStepHasThinking).toBe(false)

    // 4. finalizeAntigravityTurnThinking on open step without thought text retracts
    scope.stepIndex = 0
    scope.currentStepThinkingClosed = false
    scope.currentStepHasThoughtText = false
    openAntigravityThinkingStep(scope, 'm1', emit)
    finalizeAntigravityTurnThinking('nonexistent', 'm1', scope, corr, emit)
    const retractions = events.filter((e) => e.type === 'content_retracted')
    expect(retractions.length).toBeGreaterThanOrEqual(2)
    expect(scope.currentStepHasThinking).toBe(false)
  })
})
