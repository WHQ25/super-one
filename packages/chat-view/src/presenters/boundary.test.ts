import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))

describe('chat presenter boundary (WP-15)', () => {
  it('does not import Desktop hosts, stores, or concrete ToolBlock UI', () => {
    const hits: string[] = []
    const files = readdirSync(DIR)
      .filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx'))
      .sort()

    for (const name of files) {
      const source = readFileSync(join(DIR, name), 'utf8')
      if (/from\s+['"]@\//.test(source)) hits.push(`${name}:desktop-alias`)
      if (/from\s+['"]zustand/.test(source)) hits.push(`${name}:zustand`)
      if (/from\s+['"]electron/.test(source)) hits.push(`${name}:electron`)
      if (/from\s+['"]\.\.\//.test(source)) hits.push(`${name}:parent-import`)
      // Desktop's concrete ToolBlock UI; a sibling presenter that happens to carry the name is fine.
      if (/from\s+['"](?!\.\/)[^'"]*ToolBlock/.test(source)) hits.push(`${name}:tool-block`)
      // Desktop's preload bridges, by name: DOM `window` (scroll, resize) is this renderer's own.
      if (/\bwindow\.(agent|app|browserHost|electron|environment|miniapp|terminal)\b/.test(source)) hits.push(`${name}:window`)
    }

    expect(hits).toEqual([])
  })
})
