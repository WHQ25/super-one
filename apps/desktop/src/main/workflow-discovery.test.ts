import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverGrokWorkflows } from './workflow-discovery'

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
})
