import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { saveTemplate, type TemplateRoots } from './template-store'
import { buildWidgetPayload } from './widget-payload'

let roots: TemplateRoots
const created: string[] = []

beforeEach(() => {
  const project = mkdtempSync(join(tmpdir(), 'widget-payload-proj-'))
  const user = mkdtempSync(join(tmpdir(), 'widget-payload-user-'))
  created.push(project, user)
  roots = { project, user }
})

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('widget payload construction', () => {
  it('passes one-shot code through untouched', () => {
    const built = buildWidgetPayload(roots, { title: 'chart', widget_code: '<div>one shot</div>' })

    expect(built.error).toBeUndefined()
    expect(built.payload?.widget_code).toBe('<div>one shot</div>')
    expect(built.payload?.templateId).toBeUndefined()
  })

  it('expands a saved template so the result carries the full html snapshot', () => {
    saveTemplate(roots, { id: 'video-gen-a1b2c3d4', scope: 'project', code: '<div id="panel"></div>', title: 'Video gen' })

    const built = buildWidgetPayload(roots, { title: 'video', template: 'video-gen-a1b2c3d4' })

    expect(built.payload?.widget_code).toContain('<div id="panel"></div>')
    expect(built.payload).toMatchObject({ templateId: 'video-gen-a1b2c3d4', templateVersion: 1 })
  })

  it('exposes data on window.widget ahead of the template markup', () => {
    saveTemplate(roots, { id: 'panel-a1b2c3d4', scope: 'project', code: '<div id="panel"></div>', title: 'Panel' })

    const code = buildWidgetPayload(roots, {
      title: 'panel',
      template: 'panel-a1b2c3d4',
      data: { clips: 3 },
    }).payload!.widget_code

    expect(code.indexOf('window.widget')).toBeLessThan(code.indexOf('<div id="panel">'))
    expect(code).toContain('"clips":3')
  })

  it('escapes data that would otherwise close the injected script tag', () => {
    saveTemplate(roots, { id: 'panel-a1b2c3d4', scope: 'project', code: '<div></div>', title: 'Panel' })

    const code = buildWidgetPayload(roots, {
      title: 'panel',
      template: 'panel-a1b2c3d4',
      data: { evil: '</script><script>alert(1)</script>' },
    }).payload!.widget_code

    expect(code).not.toContain('</script><script>alert(1)')
    expect(code).toContain('\\u003c/script')
  })

  it('reports a missing template instead of rendering an empty widget', () => {
    const built = buildWidgetPayload(roots, { title: 'gone', template: 'missing-a1b2c3d4' })

    expect(built.payload).toBeUndefined()
    expect(built.error).toContain('missing-a1b2c3d4')
  })

  it('rejects a call that supplies both inline code and a template', () => {
    const built = buildWidgetPayload(roots, { title: 'x', widget_code: '<div/>', template: 'panel-a1b2c3d4' })

    expect(built.payload).toBeUndefined()
    expect(built.error).toBeTruthy()
  })

  it('rejects a call that supplies neither inline code nor a template', () => {
    const built = buildWidgetPayload(roots, { title: 'x' })

    expect(built.payload).toBeUndefined()
    expect(built.error).toBeTruthy()
  })

  it('detects svg from the resolved template code rather than the call arguments', () => {
    saveTemplate(roots, { id: 'diagram-a1b2c3d4', scope: 'project', code: '<svg viewBox="0 0 10 10"></svg>', title: 'Diagram' })

    expect(buildWidgetPayload(roots, { title: 'd', template: 'diagram-a1b2c3d4' }).payload?.isSVG).toBe(true)
  })

  it('keeps svg detection accurate when data is injected ahead of the markup', () => {
    saveTemplate(roots, { id: 'diagram-a1b2c3d4', scope: 'project', code: '<svg viewBox="0 0 10 10"></svg>', title: 'Diagram' })

    const built = buildWidgetPayload(roots, { title: 'd', template: 'diagram-a1b2c3d4', data: { a: 1 } })

    expect(built.payload?.isSVG).toBe(true)
  })

  it('carries the reusable hint through so the save dialog can prefill it', () => {
    const built = buildWidgetPayload(roots, {
      title: 'panel',
      widget_code: '<div/>',
      reusable: { id: 'panel-a1b2c3d4', description: 'A panel', inputSchema: { type: 'object' } },
    })

    expect(built.payload?.reusable).toMatchObject({ id: 'panel-a1b2c3d4', description: 'A panel' })
  })
})
