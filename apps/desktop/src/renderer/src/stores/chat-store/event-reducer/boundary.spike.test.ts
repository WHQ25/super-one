import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))

function implementationFiles(): string[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort()
}

function sourceOf(name: string): string {
  return readFileSync(join(DIR, name), 'utf8')
}

/** WP-11 relocated component predicates and injected window via ports. */
const REMAINING_COMPONENT_IMPORTS: Record<string, string> = {}

const WINDOW_FILES = new Set<string>()

describe('event-reducer extraction boundary (WP-01)', () => {
  it('does not import the Zustand barrel via ../index', () => {
    const hits: string[] = []
    for (const name of implementationFiles()) {
      if (/from\s+['"]\.\.\/index['"]/.test(sourceOf(name))) hits.push(name)
    }
    expect(hits).toEqual([])
  })

  it('does not import Zustand, slices, or window as a module', () => {
    const hits: string[] = []
    for (const name of implementationFiles()) {
      const src = sourceOf(name)
      if (/from\s+['"]zustand['"]/.test(src)) hits.push(`${name}:zustand`)
      if (/from\s+['"]\.\.\/slices\//.test(src)) hits.push(`${name}:slices`)
      if (/from\s+['"]@\/stores\//.test(src)) hits.push(`${name}:@/stores`)
    }
    expect(hits).toEqual([])
  })

  it('lists remaining @/components imports (WP-11 relocates these predicates)', () => {
    const found: Record<string, string> = {}
    for (const name of implementationFiles()) {
      const match = sourceOf(name).match(/from\s+['"](@\/components\/[^'"]+)['"]/)
      if (match) found[name] = match[1]
    }
    expect(found).toEqual(REMAINING_COMPONENT_IMPORTS)
  })

  it('lists remaining window.* impurities (trace only; inject as a port in WP-11)', () => {
    const found = implementationFiles().filter((name) => /\bwindow\./.test(sourceOf(name)))
    expect(found).toEqual([...WINDOW_FILES])
  })

  it('lifecycle family has no @/components, window, or module Maps', () => {
    const src = sourceOf('lifecycle.ts')
    expect(src).not.toMatch(/from\s+['"]@\/components\//)
    expect(src).not.toMatch(/\bwindow\./)
    expect(src).not.toMatch(/new Map\s*</)
    expect(src).toContain("from './transformers'")
  })
})
