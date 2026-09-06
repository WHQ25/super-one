import { describe, expect, it } from 'vitest'
import { sanitizeRemoteToolInput, shouldKeepRemoteToolInput } from './remote-tool-input'

describe('remote tool input exemptions', () => {
  it('keeps only inputs needed by native mobile actions', () => {
    expect(shouldKeepRemoteToolInput('mcp__superone__widget_show')).toBe(true)
    expect(shouldKeepRemoteToolInput('mcp__superone__mobile_share_file')).toBe(true)
    expect(shouldKeepRemoteToolInput('mcp__superone__media_generate_image')).toBe(true)
    expect(shouldKeepRemoteToolInput('mcp__superone__media_generate_video')).toBe(true)
    expect(shouldKeepRemoteToolInput('ReportFindings')).toBe(true)
    expect(shouldKeepRemoteToolInput('Read')).toBe(false)
    expect(shouldKeepRemoteToolInput('mcp__other__widget_showcase')).toBe(false)
  })

  it('keeps only presenter-routing metadata for Browser tools', () => {
    expect(JSON.parse(sanitizeRemoteToolInput(
      'mcp__superone__browser_act',
      JSON.stringify({
        description: 'Submit checkout',
        actions: [{ type: 'type', selector: '#password', text: 'secret-123' }, { type: 'click', selector: '#submit' }],
      }),
    ))).toEqual({
      description: 'Submit checkout',
      actions: [{ type: 'type' }, { type: 'click' }],
    })
    expect(JSON.parse(sanitizeRemoteToolInput(
      'mcp__superone__browser_snapshot',
      JSON.stringify({ include: ['screenshot'], selector: '#private' }),
    ))).toEqual({ include: ['screenshot'] })
    expect(JSON.parse(sanitizeRemoteToolInput(
      'mcp__superone__browser_tools_call',
      JSON.stringify({ name: 'add_to_cart', description: 'Add item', input: { card: '4111' } }),
    ))).toEqual({ description: 'Add item', name: 'add_to_cart' })
  })

  it('continues stripping tools no shared row reads', () => {
    expect(sanitizeRemoteToolInput('SlashCommand', '{"command":"/deploy prod"}')).toBe('')
    expect(sanitizeRemoteToolInput('mcp__other__do_thing', '{"secret":"x"}')).toBe('')
  })

  it('keeps the header fields the shared built-in tool rows read', () => {
    expect(JSON.parse(sanitizeRemoteToolInput(
      'Read',
      JSON.stringify({ file_path: '/repo/src/app.ts', offset: 10, limit: 40 }),
    ))).toEqual({ file_path: '/repo/src/app.ts', offset: 10, limit: 40 })
    expect(JSON.parse(sanitizeRemoteToolInput(
      'Bash',
      JSON.stringify({ command: 'bun test', description: 'Run tests', timeout: 5000 }),
    ))).toEqual({ command: 'bun test', description: 'Run tests', timeout: 5000 })
    expect(JSON.parse(sanitizeRemoteToolInput(
      'Grep',
      JSON.stringify({ pattern: 'TODO', path: '/repo/src', output_mode: 'content' }),
    ))).toEqual({ pattern: 'TODO', path: '/repo/src' })
  })

  it('drops edited file bodies — the row renders from the transmitted diff', () => {
    expect(JSON.parse(sanitizeRemoteToolInput(
      'Edit',
      JSON.stringify({ file_path: '/repo/a.ts', old_string: 'secret-old', new_string: 'secret-new' }),
    ))).toEqual({ file_path: '/repo/a.ts' })
    expect(JSON.parse(sanitizeRemoteToolInput(
      'Write',
      JSON.stringify({ file_path: '/repo/a.ts', content: 'whole file body' }),
    ))).toEqual({ file_path: '/repo/a.ts' })
    expect(JSON.parse(sanitizeRemoteToolInput(
      'Workflow',
      JSON.stringify({ name: 'review', script: 'export const meta = {}', validate_only: true }),
    ))).toEqual({ name: 'review', validate_only: true })
  })

  it('keeps the mini-app routing identity without the tool arguments', () => {
    expect(JSON.parse(sanitizeRemoteToolInput(
      'mcp__superone__miniapp_call',
      JSON.stringify({ appId: 'notes', tool: 'create_note', input: { body: 'private note' } }),
    ))).toEqual({ appId: 'notes', tool: 'create_note' })
  })

  it('keeps the AskUserQuestion count without the question text', () => {
    expect(JSON.parse(sanitizeRemoteToolInput(
      'AskUserQuestion',
      JSON.stringify({
        questions: [
          { question: 'Which database?', header: 'DB', options: [{ label: 'Postgres' }] },
          { question: 'Which region?', header: 'Region', options: [{ label: 'us-east' }] },
        ],
      }),
    ))).toEqual({ questions: [{}, {}] })
  })

  it('keeps only presenter-routing metadata for device and computer tools', () => {
    expect(JSON.parse(sanitizeRemoteToolInput(
      'mcp__superone__device_act',
      JSON.stringify({
        description: 'Fill the form',
        actions: [
          { type: 'type', text: 'secret', ref: 'password' },
          { type: 'keyboard', connected: false },
        ],
      }),
    ))).toEqual({
      description: 'Fill the form',
      actions: [{ type: 'type' }, { type: 'keyboard', connected: false }],
    })
    expect(JSON.parse(sanitizeRemoteToolInput(
      'mcp__superone__computer_query',
      JSON.stringify({ op: 'search', text: 'private customer', ref: 'row-4', stateId: 'state-1' }),
    ))).toEqual({ op: 'search' })
    expect(JSON.parse(sanitizeRemoteToolInput(
      'mcp__superone__computer_snapshot',
      JSON.stringify({ description: 'Inspect the window', mode: 'semantic', capture: 'screen', root: 'private-window' }),
    ))).toEqual({ description: 'Inspect the window', mode: 'semantic', capture: 'screen' })
  })

  it('keeps only visible collaboration content', () => {
    expect(JSON.parse(sanitizeRemoteToolInput(
      'mcp__superone__session_collab_send',
      JSON.stringify({ content: 'Review is complete.', to: 'peer-secret', token: 'secret' }),
    ))).toEqual({ content: 'Review is complete.' })
    expect(JSON.parse(sanitizeRemoteToolInput(
      'mcp__superone__session_collab_request',
      JSON.stringify({ launches: [{ name: 'Reviewer', role: 'review', prompt: 'private prompt' }] }),
    ))).toEqual({ launches: [{ name: 'Reviewer', role: 'review' }] })
  })

  it('keeps workflow labels without prompts or config values', () => {
    expect(JSON.parse(sanitizeRemoteToolInput(
      'mcp__superone__automation_apply',
      JSON.stringify({ action: 'update', name: 'Daily review', enabled: true, prompt: 'private' }),
    ))).toEqual({ action: 'update', name: 'Daily review', enabled: true })
    expect(JSON.parse(sanitizeRemoteToolInput(
      'mcp__superone__config_apply',
      JSON.stringify({ resource: { operation: 'update', recordId: 'secret' }, changes: [{ key: 'token', value: 'secret' }] }),
    ))).toEqual({ resource: { operation: 'update' } })
    expect(JSON.parse(sanitizeRemoteToolInput(
      'mcp__superone__session_cleanup',
      JSON.stringify({ action: 'delete', sessionIds: ['private-a', 'private-b'] }),
    ))).toEqual({ action: 'delete', sessionIds: ['', ''] })
    expect(sanitizeRemoteToolInput(
      'mcp__superone__session_search',
      JSON.stringify({ query: 'private search' }),
    )).toBe('')
  })
})
