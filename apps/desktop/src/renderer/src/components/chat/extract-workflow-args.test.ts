import { describe, it, expect } from 'vitest'
import {
  extractArgsFromAccesses,
  extractArgsFromComments,
  extractWorkflowScriptHints,
  extractWorkflowWhenToUse,
  buildWorkflowLaunchLine,
} from '@superone/shared/workflow-args'

const SAMPLE = `
let meta = #{
    name: "client-cli-coverage-scan",
    description: "Scan desktop client",
    when_to_use: "During server-client architecture migration",
    phases: [],
};

// ── args ─────────────────────────────────────────────────────────────────────
//
// Optional object fields:
//   focus      — free-text emphasis (default: server-client migration coverage)
//   domains    — array of domain ids to scan (default: all fixed domains)
//   max_verify — max features to adversarially verify (default: 16, max: 24)

let a = if args == () { #{} } else { args };
let focus = str_or(a.focus, "default");
if a.max_verify != () { }
if args.domains != () { }
`

describe('extractWorkflowWhenToUse', () => {
  it('reads when_to_use string from meta', () => {
    expect(extractWorkflowWhenToUse(SAMPLE)).toBe('During server-client architecture migration')
  })
})

describe('extractArgsFromComments', () => {
  it('parses documented fields under args section', () => {
    const args = extractArgsFromComments(SAMPLE)
    expect(args.map((a) => a.name)).toEqual(['focus', 'domains', 'max_verify'])
    expect(args[0]?.description).toMatch(/free-text emphasis/)
  })
})

describe('extractArgsFromAccesses', () => {
  it('finds args.x and a.x usages', () => {
    expect(extractArgsFromAccesses(SAMPLE)).toEqual(
      expect.arrayContaining(['focus', 'max_verify', 'domains']),
    )
  })
})

describe('extractWorkflowScriptHints', () => {
  it('merges comment docs with access names and builds example JSON', () => {
    const hints = extractWorkflowScriptHints(SAMPLE)
    expect(hints.whenToUse).toMatch(/migration/)
    expect(hints.args.map((a) => a.name)).toEqual(['focus', 'domains', 'max_verify'])
    expect(hints.args[0]?.description).toBeTruthy()
    expect(hints.exampleJson).toBeTruthy()
    const parsed = JSON.parse(hints.exampleJson!) as Record<string, unknown>
    expect(parsed).toHaveProperty('focus')
    expect(parsed).toHaveProperty('domains')
    expect(parsed).toHaveProperty('max_verify')
  })

  it('deep-research style query/objective/breadth', () => {
    const script = `
let meta = #{ name: "deep-research", description: "Research" };
let query = if args.query != () { args.query } else { args.objective };
if args.breadth != () && args.breadth >= 2 { }
`
    const hints = extractWorkflowScriptHints(script)
    expect(hints.args.map((a) => a.name).sort()).toEqual(['breadth', 'objective', 'query'])
  })
})

describe('buildWorkflowLaunchLine', () => {
  it('appends example JSON when present', () => {
    expect(buildWorkflowLaunchLine('x', '{"q":""}')).toBe('/workflow x {"q":""} ')
    expect(buildWorkflowLaunchLine('x')).toBe('/workflow x ')
  })
})
