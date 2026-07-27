import { mkdtempSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { listWidgetTemplatesHandler } from './mcp-server'
import { saveTemplate } from './template-store'

const created: string[] = []

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('widget MCP tools', () => {
  it('lists saved project templates separately from the widget manual', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'widget-mcp-'))
    created.push(projectPath)
    saveTemplate(
      { project: projectPath, user: homedir() },
      {
        id: 'review-dashboard-test',
        scope: 'project',
        code: '<div>review</div>',
        title: 'Review dashboard',
      },
    )

    const result = await listWidgetTemplatesHandler({ projectPath })

    expect(result.content[0].text).toContain('review-dashboard-test')
    expect(result.content[0].text).toContain('widget_show')
  })
})
