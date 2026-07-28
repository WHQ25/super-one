import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CHAT_COMPONENT_DIR = dirname(fileURLToPath(import.meta.url))
const FIXED_DENSITY_UTILITY = /\b(?:text|(?:max-|min-)?(?:w|h))-\[\d+px\]/

function listRuntimeComponents(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listRuntimeComponents(path)
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.') || entry.name.includes('.stories.')) return []
    return [path]
  })
}

describe('chat density utilities', () => {
  it('uses scalable Tailwind typography and size utilities', () => {
    const violations = listRuntimeComponents(CHAT_COMPONENT_DIR).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) => FIXED_DENSITY_UTILITY.test(line)
          ? [`${path.slice(CHAT_COMPONENT_DIR.length + 1)}:${index + 1}`]
          : []),
    )

    expect(violations).toEqual([])
  })
})
