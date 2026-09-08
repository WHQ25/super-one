import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { resolveSuperoneHome } from './superone-home'
import { InteractionMemoryStore } from './interaction-memory'
import { resolveHarnessHomeRoot } from '../harness/home-path'

afterEach(() => vi.unstubAllEnvs())

it('isolates personal roots by variant and accepts an exact root override', () => {
  vi.stubEnv('SUPERONE_HOME', '')
  vi.stubEnv('SUPERONE_VARIANT', 'alpha')
  expect(resolveSuperoneHome({ userHome: '/users/me' })).toBe('/users/me/.superone/alpha')
  expect(resolveSuperoneHome({ userHome: '/users/me', variant: 'stable' })).toBe('/users/me/.superone')
  expect(resolveSuperoneHome({ userHome: '/users/me', variant: 'dev' })).toBe('/users/me/.superone/dev')
  vi.stubEnv('SUPERONE_HOME', '/isolated/data')
  expect(resolveSuperoneHome()).toBe('/isolated/data')
  expect(resolveHarnessHomeRoot()).toBe('/isolated/data/harness')
})

it('keeps alpha notes separate from stable notes on the same user account', async () => {
  const home = await mkdtemp(join(tmpdir(), 's1-isolation-'))
  vi.stubEnv('SUPERONE_HOME', '')
  try {
    const stableRoot = resolveSuperoneHome({ userHome: home, variant: 'stable' })
    const alphaRoot = resolveSuperoneHome({ userHome: home, variant: 'alpha' })
    const note = { domain: 'example.com', topic: 'search', summary: 'Search', content: 'Verified steps' }
    await new InteractionMemoryStore(alphaRoot).write('browser', note)
    expect(await new InteractionMemoryStore(stableRoot).read('browser', { domain: note.domain })).toMatchObject({ count: 0 })
    expect(await readFile(join(alphaRoot, 'browser/memory/example.com/search.md'), 'utf8')).toContain(note.content)
  } finally { await rm(home, { recursive: true, force: true }) }
})
