import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { discoverGrokWorkflows } from './workflow-discovery'

function writeWorkflow(dir: string, name: string, description: string) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${name}.rhai`),
    `let meta = #{
    name: "${name}",
    description: "${description}",
};
`,
    'utf8',
  )
}

describe('discoverGrokWorkflows', () => {
  it('scans project .grok/workflows and parses documented args', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wf-disc-'))
    const dir = join(root, '.grok', 'workflows')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'client-cli-coverage-scan.rhai'),
      `let meta = #{
    name: "client-cli-coverage-scan",
    description: "Scan desktop client",
    when_to_use: "During migration",
    phases: [],
};

// ── args ─────────────────────────────────────────────────────────────────────
// Optional object fields:
//   focus      — free-text emphasis (default: server-client)
//   domains    — array of domain ids
//   max_verify — max features (default: 16)

let a = if args == () { #{} } else { args };
let focus = a.focus;
`,
      'utf8',
    )

    const found = await discoverGrokWorkflows(root)
    const hit = found.find((w) => w.name === 'client-cli-coverage-scan')
    expect(hit).toBeTruthy()
    expect(hit!.source).toBe('project')
    expect(hit!.path).toContain('client-cli-coverage-scan.rhai')
    expect(hit!.args.map((a) => a.name)).toEqual(
      expect.arrayContaining(['focus', 'domains', 'max_verify']),
    )
    expect(hit!.args.find((a) => a.name === 'focus')?.description).toMatch(/free-text/)
    expect(hit!.exampleJson).toBeTruthy()
    expect(hit!.whenToUse).toMatch(/migration/)
  })

  it('discovers repository workflows when the session cwd is a subdirectory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wf-nested-'))
    const home = mkdtempSync(join(tmpdir(), 'wf-empty-home-'))
    execFileSync('git', ['init', root])
    const cwd = join(root, 'packages', 'app')
    mkdirSync(cwd, { recursive: true })
    writeWorkflow(join(root, '.grok', 'workflows'), 'repo-workflow', 'Repository workflow')
    const found = await discoverGrokWorkflows(cwd, home)
    expect(found.map((entry) => entry.name)).toEqual(['repo-workflow'])
    expect(found[0]?.source).toBe('project')
  })

  it('lists this repo project workflows plus user-level, not another repo', async () => {
    const userHome = mkdtempSync(join(tmpdir(), 'wf-home-'))
    writeWorkflow(join(userHome, '.grok', 'workflows'), 'user-global', 'User workflow')

    const projectA = mkdtempSync(join(tmpdir(), 'wf-a-'))
    writeWorkflow(join(projectA, '.grok', 'workflows'), 'only-in-a', 'Project A only')

    const projectB = mkdtempSync(join(tmpdir(), 'wf-b-'))
    writeWorkflow(join(projectB, '.grok', 'workflows'), 'only-in-b', 'Project B only')

    const fromA = await discoverGrokWorkflows(projectA, userHome)
    const fromB = await discoverGrokWorkflows(projectB, userHome)

    expect(fromA.map((w) => w.name).sort()).toEqual(['only-in-a', 'user-global'])
    expect(fromB.map((w) => w.name).sort()).toEqual(['only-in-b', 'user-global'])
    expect(fromA.find((w) => w.name === 'only-in-a')?.source).toBe('project')
    expect(fromB.find((w) => w.name === 'only-in-b')?.source).toBe('project')
    expect(fromA.find((w) => w.name === 'user-global')?.source).toBe('user')
    expect(fromB.find((w) => w.name === 'only-in-a')).toBeUndefined()
    expect(fromA.find((w) => w.name === 'only-in-b')).toBeUndefined()
  })
})
