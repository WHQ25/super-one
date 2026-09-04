import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(import.meta.url))

describe('chat-view package boundary', () => {
  it('does not import Desktop state, Electron, or browser singleton state', () => {
    const hits: string[] = []
    const files = globSync('**/*.{ts,tsx}', { cwd: ROOT })
      .filter((name) => !name.endsWith('.test.ts') && !name.startsWith('generated-'))

    for (const name of files) {
      const source = readFileSync(`${ROOT}/${name}`, 'utf8')
      if (/from\s+['"]@\//.test(source)) hits.push(`${name}:desktop-alias`)
      if (/from\s+['"]zustand/.test(source)) hits.push(`${name}:zustand`)
      if (/from\s+['"]electron/.test(source)) hits.push(`${name}:electron`)
      if (/\bwindow\s*\./.test(source)) hits.push(`${name}:window`)
      if (/ChatInput|<textarea/.test(source)) hits.push(`${name}:composer`)
    }

    expect(hits).toEqual([])
  })

  it('routes mobile assistant turns through the shared desktop presenters', () => {
    const messageSource = readFileSync(`${ROOT}/PortableMessage.tsx`, 'utf8')
    const adapterSource = readFileSync(`${ROOT}/PortableTurnAdapters.tsx`, 'utf8')

    expect(messageSource).toContain('<PortableClaudeTurn')
    expect(messageSource).toContain('<PortableCodexTurn')
    expect(adapterSource).toContain('<ClaudeTurnBodyPresenter')
    expect(adapterSource).toContain('<CodexTurnViewPresenter')
    expect(adapterSource).toContain('TurnDetail: TurnDetailSection')
    expect(adapterSource).toContain('<ToolGroupPresenter')
    expect(messageSource).not.toMatch(/function\s+codexItem\s*\(/)
    expect(messageSource).not.toMatch(/function\s+ClaudeContent\s*\(/)
  })
})
