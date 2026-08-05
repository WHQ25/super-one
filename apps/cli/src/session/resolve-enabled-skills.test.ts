import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveEnabledSkills } from './claude-turn-runner'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('resolveEnabledSkills', () => {
  it('prefers explicit enabledSkills', () => {
    expect(resolveEnabledSkills('/tmp', ['a', 'b'], ['a'])).toEqual(['a', 'b'])
  })

  it('returns undefined when nothing is disabled', () => {
    expect(resolveEnabledSkills('/tmp', null, [])).toBeUndefined()
    expect(resolveEnabledSkills('/tmp', undefined, undefined)).toBeUndefined()
  })

  it('discovers skills and subtracts disabledSkills', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sk-'))
    dirs.push(cwd)
    mkdirSync(join(cwd, '.claude', 'skills', 'keep'), { recursive: true })
    mkdirSync(join(cwd, '.claude', 'skills', 'drop'), { recursive: true })
    writeFileSync(join(cwd, '.claude', 'skills', 'keep', 'SKILL.md'), '# Keep\n')
    writeFileSync(join(cwd, '.claude', 'skills', 'drop', 'SKILL.md'), '# Drop\n')

    const enabled = resolveEnabledSkills(cwd, null, ['drop'])
    expect(enabled).toContain('keep')
    expect(enabled).not.toContain('drop')
  })
})
