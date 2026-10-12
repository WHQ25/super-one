/**
 * Ratchet on harness-id branches in renderer code. Per-harness behavior belongs
 * in the harness's own modules; generic code reads the shared descriptor or the
 * harness registries. Counts per file may only go down.
 *
 * Counts `===`/`!==`/`==`/`!=` with a harness-id string literal on either side
 * and `case '<harnessId>':` labels. Literal-only by design (no type info).
 *
 * After removing branches, refresh the allowlist:
 *   UPDATE_HARNESS_RATCHET=1 bunx vitest run src/renderer/src/harness-ui/harness-branch-ratchet.test.ts
 * (from apps/desktop). A file whose count rises fails; fix the code instead.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from '@typescript/typescript6'
import { describe, expect, it } from 'vitest'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'

interface AllowEntry { count: number; reason: string }

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ALLOWLIST_PATH = fileURLToPath(new URL('./ratchet-allowlist.json', import.meta.url))
const HARNESS_IDS = new Set(Object.keys(HARNESS_CAPABILITIES))
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
])

/** Code that owns one harness may name it. */
const EXEMPT = [
  /^harness-ui\/(claude|codex|acp|opencode|cursor|dsh)\//,
  /^stores\/chat-store\/harness\//,
  /^stores\/chat-store\/slices\/(codex|opencode)-slice\.ts$/,
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__snapshots__' ? [] : sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : []
  })
}

function isHarnessLiteral(node: ts.Node): boolean {
  return (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && HARNESS_IDS.has(node.text)
}

function countBranches(fileName: string, text: string): number {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  let count = 0
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && EQUALITY.has(node.operatorToken.kind)
      && (isHarnessLiteral(node.left) || isHarnessLiteral(node.right))) count++
    else if (ts.isCaseClause(node) && isHarnessLiteral(node.expression)) count++
    ts.forEachChild(node, visit)
  }
  visit(source)
  return count
}

function currentCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const path of sourceFiles(ROOT)) {
    const file = relative(ROOT, path).split('\\').join('/')
    if (EXEMPT.some((pattern) => pattern.test(file))) continue
    const count = countBranches(path, readFileSync(path, 'utf8'))
    if (count > 0) counts[file] = count
  }
  return counts
}

function readAllowlist(): Record<string, AllowEntry> {
  return JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) as Record<string, AllowEntry>
}

describe('harness branch ratchet', () => {
  it('counts both comparison orders and case labels, ignoring other literals', () => {
    const probe = [
      "if (h === 'codex') {}",
      "if ('acp' !== h) {}",
      'if (h === `cursor`) {}',
      'const ok = h\n  === "opencode"',
      "switch (h) { case 'dsh': break; case 'other': break }",
      "if (h === 'not-a-harness') {}",
      "// h === 'claude'",
    ].join('\n')
    expect(countBranches('probe.ts', probe)).toBe(5)
  })

  it('never grows a file past its allowed count', () => {
    const counts = currentCounts()
    if (process.env.UPDATE_HARNESS_RATCHET) {
      const previous = readAllowlist()
      const next = Object.fromEntries(Object.keys(counts).sort().map((file) => {
        const allowed = previous[file]
        if (allowed && counts[file] > allowed.count) throw new Error(`${file}: ${counts[file]} > ${allowed.count}; remove the new branch instead`)
        return [file, { count: counts[file], reason: allowed?.reason ?? 'pre-registry baseline' }]
      }))
      writeFileSync(ALLOWLIST_PATH, `${JSON.stringify(next, null, 2)}\n`)
      return
    }
    const allowlist = readAllowlist()
    const grown = Object.entries(counts)
      .filter(([file, count]) => count > (allowlist[file]?.count ?? 0))
      .map(([file, count]) => `${file}: ${count} (allowed ${allowlist[file]?.count ?? 0})`)
    expect(grown, 'New harness-id branches. Put the behavior in the harness modules or the shared descriptor.').toEqual([])
    const stale = Object.entries(allowlist)
      .filter(([file, entry]) => (counts[file] ?? 0) < entry.count)
      .map(([file, entry]) => `${file}: ${counts[file] ?? 0} (allowed ${entry.count})`)
    expect(stale, 'Branches were removed. Lower the allowlist (UPDATE_HARNESS_RATCHET=1).').toEqual([])
  })
})
