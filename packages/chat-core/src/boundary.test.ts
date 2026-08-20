import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))

describe('chat-core package boundary (WP-13)', () => {
  it('package sources do not import zustand, electron, or @/components', () => {
    const hits: string[] = []
    for (const name of readdirSync(DIR).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const src = readFileSync(join(DIR, name), 'utf8')
      if (/from\s+['"]zustand['"]/.test(src)) hits.push(`${name}:zustand`)
      if (/from\s+['"]electron['"]/.test(src)) hits.push(`${name}:electron`)
      if (/from\s+['"]@\/components\//.test(src)) hits.push(`${name}:components`)
    }
    expect(hits).toEqual([])
  })
})
