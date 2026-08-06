import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverAllAgents, readAgentFile } from './agents-discover'

describe('agents-discover', () => {
  let home: string
  let project: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ag-home-'))
    project = mkdtempSync(join(tmpdir(), 'ag-proj-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  })

  it('discovers project and user agents with scope tags', () => {
    mkdirSync(join(project, '.claude', 'agents'), { recursive: true })
    writeFileSync(
      join(project, '.claude', 'agents', 'reviewer.md'),
      '---\ndescription: Reviews code\nmodel: sonnet\n---\n# reviewer\n',
    )
    mkdirSync(join(home, '.claude', 'agents'), { recursive: true })
    writeFileSync(
      join(home, '.claude', 'agents', 'planner.md'),
      '---\ndescription: Plans work\n---\n# planner\n',
    )

    const agents = discoverAllAgents(project, { homeDir: home })
    expect(agents.map((a) => a.name).sort()).toEqual(['planner', 'reviewer'])
    expect(agents.find((a) => a.name === 'reviewer')?.scope).toBe('project')
    expect(agents.find((a) => a.name === 'planner')?.scope).toBe('user')
    expect(agents.find((a) => a.name === 'reviewer')?.model).toBe('sonnet')
  })

  it('reads agent markdown by name', () => {
    mkdirSync(join(project, '.claude', 'agents'), { recursive: true })
    writeFileSync(
      join(project, '.claude', 'agents', 'ship.md'),
      '---\ndescription: Ship it\n---\n# ship\n',
    )
    const content = readAgentFile(project, 'ship', { homeDir: home })
    expect(content).toContain('Ship it')
  })
})
