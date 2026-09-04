import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))

describe('chat-core package boundary (WP-13)', () => {
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
      if (name !== 'ports.ts' && /new Map\s*[<(]/.test(src)) hits.push(`${name}:module-map`)
    }
    expect(hits).toEqual([])
  })
})
