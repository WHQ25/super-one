import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export type TemplateScope = 'project' | 'user'

export interface TemplateRoots {
  project?: string
  user: string
}

export interface WidgetTemplate {
  id: string
  scope: TemplateScope
  title: string
  description?: string
  inputSchema?: Record<string, unknown>
  version: number
  code: string
  createdAt: string
  updatedAt: string
}

export interface SaveTemplateInput {
  id: string
  scope: TemplateScope
  code: string
  title: string
  description?: string
  inputSchema?: Record<string, unknown>
}

const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

export function isValidTemplateId(id: string): boolean {
  return TEMPLATE_ID_PATTERN.test(id) && id.length <= 128
}

function widgetDir(root: string): string {
  return join(root, '.superone', 'widget')
}

function scopeRoots(roots: TemplateRoots): Array<{ scope: TemplateScope; root: string }> {
  const ordered: Array<{ scope: TemplateScope; root: string }> = []
  if (roots.project) ordered.push({ scope: 'project', root: roots.project })
  ordered.push({ scope: 'user', root: roots.user })
  return ordered
}

function rootFor(roots: TemplateRoots, scope: TemplateScope): string {
  if (scope === 'user') return roots.user
  if (!roots.project) throw new Error('no project root available for a project-scope template')
  return roots.project
}

function loadFrom(root: string, scope: TemplateScope, id: string): WidgetTemplate | null {
  const dir = join(widgetDir(root), id)
  try {
    const meta = JSON.parse(readFileSync(join(dir, 'template.json'), 'utf-8')) as Partial<WidgetTemplate>
    const code = readFileSync(join(dir, 'widget.html'), 'utf-8')
    return {
      id,
      scope,
      title: typeof meta.title === 'string' ? meta.title : id,
      description: typeof meta.description === 'string' ? meta.description : undefined,
      inputSchema: meta.inputSchema,
      version: typeof meta.version === 'number' ? meta.version : 1,
      code,
      createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : '',
      updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : '',
    }
  } catch {
    return null
  }
}

export function readTemplate(roots: TemplateRoots, id: string): WidgetTemplate | null {
  if (!isValidTemplateId(id)) return null
  for (const { scope, root } of scopeRoots(roots)) {
    const found = loadFrom(root, scope, id)
    if (found) return found
  }
  return null
}

export function listTemplates(roots: TemplateRoots): WidgetTemplate[] {
  const byId = new Map<string, WidgetTemplate>()
  for (const { scope, root } of scopeRoots(roots)) {
    let entries: string[]
    try {
      entries = readdirSync(widgetDir(root), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      continue
    }
    for (const id of entries) {
      if (byId.has(id) || !isValidTemplateId(id)) continue
      const loaded = loadFrom(root, scope, id)
      if (loaded) byId.set(id, loaded)
    }
  }
  return [...byId.values()]
}

export function formatTemplateList(templates: WidgetTemplate[]): string {
  if (templates.length === 0) return ''
  const rows = [...templates]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => {
      const schema = t.inputSchema ? ` Data: ${JSON.stringify(t.inputSchema)}` : ''
      return `- \`${t.id}\` (${t.scope}) — ${t.description || t.title}.${schema}`
    })
  return [
    '## Saved templates',
    '',
    'The user saved these widgets for reuse. When one fits the task, re-render it with',
    '`widget_show({ template: "<id>", data: { ... } })` instead of writing new code.',
    '',
    ...rows,
    '',
    '---',
    '',
  ].join('\n')
}

function slugify(requested: string): string {
  const slug = requested
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'widget'
}

export function allocateTemplateId(roots: TemplateRoots, requested: string, scope: TemplateScope): string {
  if (isValidTemplateId(requested) && templateExists(roots, requested, scope)) return requested
  return `${slugify(requested)}-${randomUUID().slice(0, 8)}`
}

export function templateExists(roots: TemplateRoots, id: string, scope: TemplateScope): boolean {
  if (!isValidTemplateId(id)) return false
  return existsSync(join(widgetDir(rootFor(roots, scope)), id, 'template.json'))
}

export function saveTemplate(roots: TemplateRoots, input: SaveTemplateInput): WidgetTemplate {
  if (!isValidTemplateId(input.id)) throw new Error(`invalid widget template id: ${input.id}`)
  const dir = join(widgetDir(rootFor(roots, input.scope)), input.id)
  const previous = loadFrom(rootFor(roots, input.scope), input.scope, input.id)
  const now = new Date().toISOString()
  const meta = {
    id: input.id,
    title: input.title,
    description: input.description,
    inputSchema: input.inputSchema,
    version: (previous?.version ?? 0) + 1,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'widget.html'), input.code)
  writeFileSync(join(dir, 'template.json'), `${JSON.stringify(meta, null, 2)}\n`)
  return { ...meta, scope: input.scope, code: input.code }
}
