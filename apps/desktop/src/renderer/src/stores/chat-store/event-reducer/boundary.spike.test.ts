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

describe('event-reducer package boundary (WP-12)', () => {
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

  it('does not import renderer components', () => {
    const found: string[] = []
    for (const name of implementationFiles()) {
      if (/from\s+['"]@\/components\//.test(sourceOf(name))) found.push(name)
    }
    expect(found).toEqual([])
  })

  it('keeps window access in the Desktop adapter only', () => {
    const found = implementationFiles().filter((name) => /\bwindow\./.test(sourceOf(name)))
    expect(found).toEqual(['index.ts'])

    const adapter = sourceOf('index.ts')
    expect(adapter).toContain('const desktopChatCorePorts: ChatCorePorts')
    expect(adapter).toContain('window.app?.trace?.(channel, name, payload)')
    expect(adapter).toContain('applyCoreEventToSession(session, event, ports)')
  })

  it('keeps reducer-family files as chat-core compatibility shims', () => {
    const shims = implementationFiles().filter((name) => name !== 'index.ts')
    const nonPackageShims = shims.filter(
      (name) => !/from\s+['"]@superone\/chat-core['"]/.test(sourceOf(name)),
    )

    expect(nonPackageShims).toEqual([])
    expect(sourceOf('lifecycle.ts')).toContain(
      "export { reduceLifecycle } from '@superone/chat-core'",
    )
  })
})
