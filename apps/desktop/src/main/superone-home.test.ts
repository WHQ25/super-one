import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ home: '', appPath: '' }))
vi.mock('electron', () => ({ app: {
  getPath: () => state.home,
  getAppPath: () => state.appPath,
} }))
afterEach(() => { vi.unstubAllEnvs(); if (state.home) rmSync(state.home, { recursive: true, force: true }) })

it('isolates personal and project templates between packaged stable and alpha', async () => {
  state.home = mkdtempSync(join(tmpdir(), 'superone-roots-'))
  state.appPath = join(state.home, 'app')
  mkdirSync(state.appPath)
  vi.stubEnv('SUPERONE_HOME', '')
  const project = join(state.home, 'project')
  for (const variant of ['stable', 'alpha']) {
    writeFileSync(join(state.appPath, 'package.json'), JSON.stringify({ variant }))
    vi.resetModules()
    const { superoneHome, projectSuperoneHome } = await import('./superone-home')
    const { resolveHarnessHomeRoot } = await import('./harness/home')
    const { saveTemplate, listTemplates } = await import('./generative-ui/template-store')
    const suffix = variant === 'alpha' ? '.superone/alpha' : '.superone'
    expect(superoneHome()).toBe(join(state.home, suffix))
    expect(projectSuperoneHome(project)).toBe(join(project, suffix))
    expect(resolveHarnessHomeRoot()).toBe(join(state.home, suffix, 'harness'))
    const roots = { project, user: superoneHome() }
    expect(listTemplates(roots)).toEqual([])
    saveTemplate(roots, { id: 'personal', scope: 'user', title: 'Personal', code: variant })
    saveTemplate(roots, { id: 'workspace', scope: 'project', title: 'Workspace', code: variant })
    expect(existsSync(join(state.home, suffix, 'widget/personal/widget.html'))).toBe(true)
    expect(existsSync(join(project, suffix, 'widget/workspace/widget.html'))).toBe(true)
    expect(listTemplates(roots).map(template => template.code)).toEqual([variant, variant])
    vi.stubEnv('SUPERONE_HOME', join(state.home, 'custom'))
    expect(superoneHome()).toBe(join(state.home, 'custom'))
    expect(projectSuperoneHome(project)).toBe(join(project, suffix))
    vi.stubEnv('SUPERONE_HOME', '')
  }
})
