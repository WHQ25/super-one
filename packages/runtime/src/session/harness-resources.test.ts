import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectHarnessResources, discoverCodexUserPrompts } from './harness-resources'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('collectHarnessResources', () => {
  it('aggregates models + FS skills/commands/agents without desktop cache', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hr-home-'))
    const project = mkdtempSync(join(tmpdir(), 'hr-proj-'))
    dirs.push(home, project)

    mkdirSync(join(project, '.claude', 'skills', 'ship'), { recursive: true })
    writeFileSync(
      join(project, '.claude', 'skills', 'ship', 'SKILL.md'),
      '---\ndescription: Ship it\n---\n# ship\n',
    )
    mkdirSync(join(project, '.claude', 'commands'), { recursive: true })
    writeFileSync(
      join(project, '.claude', 'commands', 'review.md'),
      '---\ndescription: Review PR\n---\n',
    )
    mkdirSync(join(project, '.claude', 'agents'), { recursive: true })
    writeFileSync(
      join(project, '.claude', 'agents', 'reviewer.md'),
      '---\ndescription: Code reviewer\n---\n',
    )
    mkdirSync(join(home, '.codex', 'prompts'), { recursive: true })
    writeFileSync(
      join(home, '.codex', 'prompts', 'align.md'),
      '---\ndescription: Align requirements\n---\n',
    )

    const listModels = (harnessId: string) => {
      if (harnessId === 'claude') {
        return [{ id: 'claude-sonnet-4-5', name: 'Sonnet', description: '', isDefault: true }]
      }
      if (harnessId === 'codex') {
        return [{ id: 'gpt-5.2', name: 'GPT-5.2', description: '' }]
      }
      return []
    }

    const bundle = await collectHarnessResources({
      projectPath: project,
      homeDir: home,
      listModels,
    })

    expect(bundle.claude.models.map((m) => m.id)).toEqual(['claude-sonnet-4-5'])
    expect(bundle.claude.skills.some((s) => s.name === 'ship')).toBe(true)
    expect(bundle.claude.commands.some((c) => c.name === 'review')).toBe(true)
    expect(bundle.claude.agents.some((a) => a.name === 'reviewer')).toBe(true)
    expect(bundle.codex.models.map((m) => m.id)).toEqual(['gpt-5.2'])
    expect(bundle.codex.prompts.some((p) => p.name === 'align')).toBe(true)
  })

  it('harnessId filter only fills that section', async () => {
    const project = mkdtempSync(join(tmpdir(), 'hr-only-'))
    dirs.push(project)
    const bundle = await collectHarnessResources({
      projectPath: project,
      listModels: (h) =>
        h === 'codex' ? [{ id: 'gpt-5.2', name: 'G', description: '' }] : [],
      harnessId: 'codex',
    })
    expect(bundle.codex.models).toHaveLength(1)
    expect(bundle.claude.models).toHaveLength(0)
  })

  it('probe hooks keep empty defaults when probes throw', async () => {
    const project = mkdtempSync(join(tmpdir(), 'hr-probe-'))
    dirs.push(project)
    const bundle = await collectHarnessResources({
      projectPath: project,
      listModels: () => [{ id: 'm1', name: 'M', description: '' }],
      harnessId: 'claude',
      probeAccount: async () => {
        throw new Error('no cli')
      },
      probeSlashCommands: async () => {
        throw new Error('no sdk')
      },
      probeOutputStyles: async () => {
        throw new Error('no styles')
      },
    })
    expect(bundle.claude.models).toHaveLength(1)
    expect(bundle.claude.account).toEqual({})
    expect(bundle.claude.slashCommands).toEqual([])
    expect(bundle.claude.outputStyles).toEqual([])
  })

  it('probe hooks populate account/slashCommands/outputStyles when available', async () => {
    const project = mkdtempSync(join(tmpdir(), 'hr-probe-ok-'))
    dirs.push(project)
    const bundle = await collectHarnessResources({
      projectPath: project,
      listModels: () => [],
      harnessId: 'claude',
      probeAccount: async () => ({ email: 'a@b.com' }),
      probeSlashCommands: async () => [
        { name: 'help', description: 'Help', argumentHint: '', isSkill: false },
      ],
      probeOutputStyles: async () => ['Explanatory'],
    })
    expect(bundle.claude.account).toEqual({ email: 'a@b.com' })
    expect(bundle.claude.slashCommands.map((c) => c.name)).toEqual(['help'])
    expect(bundle.claude.outputStyles).toEqual(['Explanatory'])
  })

  it('probes the node model catalog when the provider store has none', async () => {
    // Without a bound credential the provider store has no catalog; the node
    // must report what its harness actually serves, not a hardcoded slug list.
    const project = mkdtempSync(join(tmpdir(), 'hr-models-probe-'))
    dirs.push(project)
    const probed: string[] = []
    const bundle = await collectHarnessResources({
      projectPath: project,
      listModels: () => [],
      probeModels: async (harnessId) => {
        probed.push(harnessId)
        return harnessId === 'claude'
          ? [{ id: 'opus[1m]', name: 'Opus 5 1M', description: 'Opus 5 with 1M context' }]
          : []
      },
      harnessId: 'claude',
    })
    expect(probed).toEqual(['claude'])
    expect(bundle.claude.models.map((m) => m.id)).toEqual(['opus[1m]'])
  })

  it('prefers the provider store catalog over the probe', async () => {
    const project = mkdtempSync(join(tmpdir(), 'hr-models-provider-'))
    dirs.push(project)
    let probeCalls = 0
    const bundle = await collectHarnessResources({
      projectPath: project,
      listModels: () => [{ id: 'relay-opus', name: 'Relay Opus', description: '' }],
      probeModels: async () => {
        probeCalls += 1
        return [{ id: 'opus[1m]', name: 'Opus 5 1M', description: '' }]
      },
      harnessId: 'claude',
    })
    expect(bundle.claude.models.map((m) => m.id)).toEqual(['relay-opus'])
    expect(probeCalls).toBe(0)
  })

  it('keeps an empty catalog when the model probe fails', async () => {
    const project = mkdtempSync(join(tmpdir(), 'hr-models-fail-'))
    dirs.push(project)
    const bundle = await collectHarnessResources({
      projectPath: project,
      listModels: () => [],
      probeModels: async () => {
        throw new Error('probe exploded')
      },
      harnessId: 'claude',
    })
    expect(bundle.claude.models).toEqual([])
  })
})

describe('discoverCodexUserPrompts', () => {
  it('reads ~/.codex/prompts', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-prompts-'))
    dirs.push(home)
    mkdirSync(join(home, '.codex', 'prompts'), { recursive: true })
    writeFileSync(join(home, '.codex', 'prompts', 'tdd.md'), '---\ndescription: TDD\n---\n')
    expect(discoverCodexUserPrompts({ homeDir: home })).toEqual([
      { name: 'tdd', description: 'TDD', argumentHint: '', isSkill: false },
    ])
  })
})
