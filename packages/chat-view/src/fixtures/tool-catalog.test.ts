import { describe, expect, it } from 'vitest'
import { isAlwaysHiddenToolName } from '@superone/shared/tool-ui'
import {
  TOOL_CATALOG_CATEGORIES,
  toolCatalogExamples,
  toolCatalogMessages,
} from './tool-catalog'

function toolNames(): string[] {
  return toolCatalogExamples.flatMap((example) => example.blocks
    .filter((block) => 'toolName' in block)
    .map((block) => (block as { toolName: string }).toolName))
}

describe('tool catalog', () => {
  it('gives every example a unique id inside a known category', () => {
    const ids = toolCatalogExamples.map((example) => example.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const example of toolCatalogExamples) {
      expect(TOOL_CATALOG_CATEGORIES).toContain(example.category)
    }
  })

  it('never catalogs a tool the transcript always hides', () => {
    // `TodoWrite` and `session_rename` were both in here and rendered as a bare title with
    // no row — a hidden tool has nothing to show, so listing one is a silent blank entry.
    for (const tool of toolNames()) {
      expect({ tool, hidden: isAlwaysHiddenToolName(tool) }).toEqual({ tool, hidden: false })
    }
  })

  it('covers every family the shared row renders specially', () => {
    const names = toolNames()
    // Each of these takes a different branch out of the row — a family with no example
    // is a family nobody looks at until it breaks on a real phone.
    for (const tool of [
      'Read', 'Edit', 'Write', 'FileChange', 'NotebookEdit',
      'Bash', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch',
      'Skill', 'Task', 'AskUserQuestion', 'ReportFindings', 'ListAgents', 'ExitPlanMode',
      'mcp__superone__browser_snapshot', 'mcp__superone__browser_act',
      'mcp__superone__device_snapshot', 'mcp__superone__computer_query',
      'mcp__superone__media_generate_image', 'mcp__superone__media_generate_video',
      'mcp__superone__miniapp_call', 'mcp__superone__config_apply',
      'mcp__superone__session_collab_send',
    ]) {
      expect(names).toContain(tool)
    }
  })

  it('projects every input exactly as the transport does', () => {
    const byId = new Map(toolCatalogExamples.map((example) => [example.id, example]))
    const edit = byId.get('files/edit')!.blocks[0] as { input: string; type: string }
    // `old_string` / `new_string` never reach a remote surface — the row draws `toolDiff`.
    expect(JSON.parse(edit.input)).toEqual({ file_path: '/workspace/super-one/apps/mobile/src/config.ts' })
    expect(edit.type).toBe('edit')

    const browser = byId.get('browser/act')!.blocks[0] as { input: string }
    expect(JSON.parse(browser.input)).toEqual({
      description: 'Sign in and open settings',
      actions: [{ type: 'type' }, { type: 'click' }],
    })

    const miniApp = byId.get('superone/miniapp-call')!.blocks[0] as { input: string }
    expect(JSON.parse(miniApp.input)).toEqual({ appId: 'notes', tool: 'create_note' })
  })

  it('builds one titled assistant turn per example and filters by category', () => {
    const all = toolCatalogMessages()
    expect(all).toHaveLength(toolCatalogExamples.length)
    expect(all[0]!.content[0]).toMatchObject({ type: 'text' })

    const shell = toolCatalogMessages('Shell')
    expect(shell.length).toBeGreaterThan(0)
    expect(shell.length).toBeLessThan(all.length)
    expect(shell.every((message) => message.id.startsWith('catalog-shell/'))).toBe(true)
  })

  it('pairs every result with the call it belongs to', () => {
    for (const example of toolCatalogExamples) {
      const callIds = new Set(example.blocks
        .filter((block) => 'toolName' in block)
        .map((block) => (block as { toolUseId: string }).toolUseId))
      for (const block of example.blocks) {
        if (block.type !== 'tool_result') continue
        expect(callIds).toContain(block.toolUseId)
      }
    }
  })
})
