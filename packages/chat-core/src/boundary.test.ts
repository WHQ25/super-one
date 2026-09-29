import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))

/**
 * State shared across sessions must come through `ports`, so a Map at module
 * scope is banned. A Map local to a reducer call is ordinary code. Module scope
 * is a statement starting at column 0, or the unindented declaration a wrapped
 * initializer continues.
 */
function hasModuleScopeMap(src: string): boolean {
  const lines = src.split('\n')
  return lines.some((line, i) => {
    if (!/new Map\s*[<(]/.test(line)) return false
    if (!/^\s/.test(line)) return true
    const prev = lines[i - 1] ?? ''
    return !/^\s/.test(prev) && /=\s*$/.test(prev)
  })
}

describe('chat-core package boundary', () => {
  it('package sources stay independent from desktop and browser globals', () => {
    const hits: string[] = []
    for (const name of readdirSync(DIR).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const src = readFileSync(join(DIR, name), 'utf8')
      if (/from\s+['"]zustand['"]/.test(src)) hits.push(`${name}:zustand`)
      if (/from\s+['"]electron['"]/.test(src)) hits.push(`${name}:electron`)
      if (/from\s+['"]@\//.test(src)) hits.push(`${name}:desktop-alias`)
      if (/apps\/desktop/.test(src)) hits.push(`${name}:desktop-path`)
      if (/from\s+['"]\.\.\//.test(src)) hits.push(`${name}:parent-import`)
      if (/\bwindow\s*\./.test(src)) hits.push(`${name}:window`)
      if (name !== 'ports.ts' && hasModuleScopeMap(src)) hits.push(`${name}:module-map`)
    }
    expect(hits).toEqual([])
  })
})
