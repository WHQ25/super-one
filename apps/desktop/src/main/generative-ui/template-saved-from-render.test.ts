import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildWidgetData, injectWidgetData } from '@superone/shared/generative-ui/widget-data'
import { readTemplate, saveTemplate, type TemplateRoots } from './template-store'
import { buildWidgetPayload } from './widget-payload'

/**
 * "Save as template" sends the code a widget rendered with, which starts with the prelude
 * that injected its `data`. Stored as it was, that prelude ran after the one a later render
 * injected and put the saved data back.
 */
const SOURCE = '<div id="n"></div><script>n.textContent=window.widget.data.builds</script>'
const ID = 'builds-a1b2c3d4'

let roots: TemplateRoots

beforeEach(() => {
  roots = { user: mkdtempSync(join(tmpdir(), 'widget-user-')) }
})

afterEach(() => {
  rmSync(roots.user, { recursive: true, force: true })
})

function templateDir(id: string): string {
  return join(roots.user, 'widget', id)
}

function storedSource(id = ID): string {
  return readFileSync(join(templateDir(id), 'widget.html'), 'utf-8')
}

function seed(code: string, id = ID): void {
  mkdirSync(templateDir(id), { recursive: true })
  writeFileSync(join(templateDir(id), 'widget.html'), code)
  writeFileSync(join(templateDir(id), 'template.json'), JSON.stringify({ id, title: 'Builds', version: 1 }))
}

function save(code: string, id = ID) {
  return saveTemplate(roots, { id, scope: 'user', title: 'Builds', code })
}

function render(data: Record<string, unknown>, id = ID) {
  return buildWidgetPayload(roots, { title: 'builds', template: id, data }).payload!
}

describe('a widget saved as a template', () => {
  it('renders with the data of each later call, not the data it was saved with', () => {
    save(buildWidgetData({ title: 'builds', source: SOURCE, data: { builds: 3 } }).widget_code)
    expect(storedSource()).toBe(SOURCE)
    expect(render({ builds: 7 }).widget_code).toBe(injectWidgetData(SOURCE, { builds: 7 }))
  })

  it('keeps one source when a templated widget is saved again', () => {
    save(buildWidgetData({ title: 'builds', source: SOURCE, data: { builds: 3 } }).widget_code)
    expect(save(render({ builds: 7 }).widget_code)).toMatchObject({ version: 2, code: SOURCE })
    expect(storedSource()).toBe(SOURCE)
  })

  it('renders a template stored with stacked preludes with current data, and saving it cleans the file', () => {
    seed(injectWidgetData(injectWidgetData(SOURCE, { builds: 1 }), { builds: 2 }))
    expect(readTemplate(roots, ID)?.code).toBe(SOURCE)
    const rendered = render({ builds: 7 })
    expect(rendered.widget_code).toBe(injectWidgetData(SOURCE, { builds: 7 }))
    save(rendered.widget_code)
    expect(storedSource()).toBe(SOURCE)
  })

  it('stores scripts that only resemble the prelude as they are', () => {
    const prelude = '<script>window.widget=Object.assign(window.widget||{},{data:'
    for (const code of [`${prelude}[1,2]})</script>${SOURCE}`, `${prelude}{oops})</script>${SOURCE}`, SOURCE]) {
      save(code)
      expect(storedSource()).toBe(code)
    }
  })

  it('draws an SVG template as SVG once its stored prelude is gone', () => {
    seed(injectWidgetData('<svg viewBox="0 0 10 10"><text>72</text></svg>', { pct: 72 }))
    expect(render({ pct: 80 }).isSVG).toBe(true)
  })
})
