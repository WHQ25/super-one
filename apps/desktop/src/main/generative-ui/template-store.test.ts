import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  allocateTemplateId,
  formatTemplateList,
  listTemplates,
  readTemplate,
  saveTemplate,
  templateExists,
  type TemplateRoots,
} from './template-store'

let roots: TemplateRoots
const created: string[] = []

function tmpRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

function seed(root: string, id: string, code: string, meta: Record<string, unknown> = {}): void {
  const dir = join(root, '.superone', 'widget', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'widget.html'), code)
  writeFileSync(join(dir, 'template.json'), JSON.stringify({ id, title: id, version: 1, ...meta }))
}

beforeEach(() => {
  roots = { project: tmpRoot('widget-proj-'), user: tmpRoot('widget-user-') }
})

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('widget template store', () => {
  it('reads back a template saved to the project scope', () => {
    saveTemplate(roots, { id: 'video-gen-a1b2c3d4', scope: 'project', code: '<div>gen</div>', title: 'Video gen' })

    const found = readTemplate(roots, 'video-gen-a1b2c3d4')
    expect(found).toMatchObject({ id: 'video-gen-a1b2c3d4', scope: 'project', code: '<div>gen</div>', title: 'Video gen' })
  })

  it('shadows a user template when the project defines the same id', () => {
    seed(roots.user!, 'panel-aaaaaaaa', '<div>user</div>')
    seed(roots.project!, 'panel-aaaaaaaa', '<div>project</div>')

    expect(readTemplate(roots, 'panel-aaaaaaaa')?.code).toBe('<div>project</div>')
  })

  it('lists both scopes and keeps only the project copy of a shadowed id', () => {
    seed(roots.user!, 'shared-aaaaaaaa', '<div>user</div>')
    seed(roots.project!, 'shared-aaaaaaaa', '<div>project</div>')
    seed(roots.user!, 'personal-bbbbbbbb', '<div>only user</div>')

    const listed = listTemplates(roots)

    expect(listed.map((t) => t.id).sort()).toEqual(['personal-bbbbbbbb', 'shared-aaaaaaaa'])
    expect(listed.find((t) => t.id === 'shared-aaaaaaaa')?.scope).toBe('project')
  })

  it('reports an existing id so the caller can confirm before overwriting', () => {
    seed(roots.project!, 'panel-aaaaaaaa', '<div>x</div>')

    expect(templateExists(roots, 'panel-aaaaaaaa', 'project')).toBe(true)
    expect(templateExists(roots, 'panel-aaaaaaaa', 'user')).toBe(false)
  })

  it('returns null for an unknown id', () => {
    expect(readTemplate(roots, 'nope-aaaaaaaa')).toBeNull()
  })

  it('skips a malformed template directory instead of failing the whole listing', () => {
    seed(roots.user!, 'good-aaaaaaaa', '<div>ok</div>')
    const broken = join(roots.user!, '.superone', 'widget', 'broken-bbbbbbbb')
    mkdirSync(broken, { recursive: true })
    writeFileSync(join(broken, 'template.json'), '{ not json')

    expect(listTemplates(roots).map((t) => t.id)).toEqual(['good-aaaaaaaa'])
  })

  it('rejects an id that would escape the widget directory', () => {
    expect(() => saveTemplate(roots, { id: '../../evil', scope: 'project', code: '<div/>', title: 'x' })).toThrow()
    expect(existsSync(join(roots.project!, '..', 'evil'))).toBe(false)
    expect(readTemplate(roots, '../../evil')).toBeNull()
  })

  it('bumps the version when an existing template is overwritten', () => {
    saveTemplate(roots, { id: 'panel-aaaaaaaa', scope: 'project', code: '<div>v1</div>', title: 'Panel' })
    saveTemplate(roots, { id: 'panel-aaaaaaaa', scope: 'project', code: '<div>v2</div>', title: 'Panel' })

    const found = readTemplate(roots, 'panel-aaaaaaaa')
    expect(found?.code).toBe('<div>v2</div>')
    expect(found?.version).toBe(2)
  })

  it('gives a brand new template a unique suffixed id so distinct saves never collide', () => {
    const first = allocateTemplateId(roots, 'video gen', 'project')
    const second = allocateTemplateId(roots, 'video gen', 'project')

    expect(first).toMatch(/^video-gen-[0-9a-f]{8}$/)
    expect(second).not.toBe(first)
  })

  it('reuses the id verbatim when it already names a template in that scope', () => {
    seed(roots.project!, 'video-gen-a1b2c3d4', '<div>v1</div>')

    expect(allocateTemplateId(roots, 'video-gen-a1b2c3d4', 'project')).toBe('video-gen-a1b2c3d4')
  })

  it('treats an id that exists only in the other scope as a new template', () => {
    seed(roots.user!, 'video-gen-a1b2c3d4', '<div>user copy</div>')

    expect(allocateTemplateId(roots, 'video-gen-a1b2c3d4', 'project')).not.toBe('video-gen-a1b2c3d4')
  })

  it('strips characters that are not valid in a template id', () => {
    expect(allocateTemplateId(roots, '../Video Gen!!', 'project')).toMatch(/^video-gen-[0-9a-f]{8}$/)
  })

  it('works with no project root so user-scope templates still resolve', () => {
    const userOnly: TemplateRoots = { user: roots.user! }
    seed(roots.user!, 'personal-aaaaaaaa', '<div>mine</div>')

    expect(readTemplate(userOnly, 'personal-aaaaaaaa')?.scope).toBe('user')
    expect(listTemplates(userOnly)).toHaveLength(1)
  })
})

describe('template list rendered into the guide', () => {
  it('renders nothing when no templates are saved so the guide is unchanged', () => {
    expect(formatTemplateList([])).toBe('')
  })

  it('lists each template with its scope, description and expected data shape', () => {
    saveTemplate(roots, {
      id: 'video-gen-a1b2c3d4',
      scope: 'project',
      code: '<div/>',
      title: 'Video gen',
      description: 'Panel for driving the video CLI',
      inputSchema: { type: 'object', properties: { prompt: { type: 'string' } } },
    })

    const rendered = formatTemplateList(listTemplates(roots))

    expect(rendered).toContain('`video-gen-a1b2c3d4` (project)')
    expect(rendered).toContain('Panel for driving the video CLI')
    expect(rendered).toContain('"prompt"')
    expect(rendered).toContain('widget_show({ template: "<id>", data: { ... } })')
  })

  it('falls back to the title when a template has no description', () => {
    saveTemplate(roots, { id: 'plain-a1b2c3d4', scope: 'user', code: '<div/>', title: 'Plain panel' })

    expect(formatTemplateList(listTemplates(roots))).toContain('(user) — Plain panel.')
  })
})
