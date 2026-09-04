import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))
const CHAT_DIR = join(DIR, '..')

describe('ToolBlock presenter boundary (WP-16)', () => {
  it('keeps stores, IPC, and Desktop-only renderers in the adapter shell', () => {
    const files = [
      join(CHAT_DIR, 'ToolBlockPresenter.tsx'),
      ...readdirSync(DIR)
        .filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx'))
        .sort()
        .map((name) => join(DIR, name)),
    ]
    const hits: string[] = []

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const name = file.slice(CHAT_DIR.length + 1)
      if (/from\s+['"]@\//.test(source)) hits.push(`${name}:desktop-alias`)
      if (/from\s+['"](?:zustand|electron)/.test(source)) hits.push(`${name}:desktop-runtime`)
      if (/\bwindow\s*\./.test(source)) hits.push(`${name}:window`)
      if (/\buse(?:ChatStore|ActiveSession|BashOutput|ShareProgress|SettingsStore|AppStore|MiniAppStore)\b/.test(source)) {
        hits.push(`${name}:host-store`)
      }
      if (/from\s+['"].*(?:FileChip|CanvasEditDiff|ToolRendererFrame|StandaloneToolBlock|MiniAppIcon)/.test(source)) {
        hits.push(`${name}:host-renderer`)
      }
    }

    expect(hits).toEqual([])
  })
})
