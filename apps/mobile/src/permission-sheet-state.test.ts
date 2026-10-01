import { describe, expect, it } from 'vitest'
import type { PermissionRequest } from '@superone/shared/agent-types'
import {
  defaultPermissionFormAnswers,
  permissionSuggestionLabel,
  permissionSchemaForm,
  permissionSheetPresentation,
} from './permission-sheet-state'

const kindSet = {
  mcp_elicitation: true,
  video_gen_confirm: true,
  config_confirm: true,
  session_agents_confirm: true,
  computer_use_grant: true,
  session_cleanup_confirm: true,
  automation_confirm: true,
  webmcp_trust_confirm: true,
  device_control_confirm: true,
  terminal_command_confirm: true,
} satisfies Record<NonNullable<PermissionRequest['requestKind']>, true>
const kinds = Object.keys(kindSet) as NonNullable<PermissionRequest['requestKind']>[]

function request(requestKind: NonNullable<PermissionRequest['requestKind']>): PermissionRequest {
  return { requestId: requestKind, requestKind, toolName: 'test_tool', input: {}, allowAlwaysAllow: true }
}

describe('permission sheet state', () => {
  it('has dedicated copy for every current request kind', () => {
    const titles = kinds.map((kind) => permissionSheetPresentation(request(kind)).title)
    expect(new Set(titles).size).toBe(kinds.length)
    expect(titles.every(Boolean)).toBe(true)
  })

  it('uses device-scoped actions for device control approval', () => {
    const deviceRequest = request('device_control_confirm')
    deviceRequest.input = { device: 'iPhone 17 Pro Max', platform: 'iOS 26.5', description: 'Verify the gallery layout.', note: 'Another chat will lose it.' }
    deviceRequest.message = 'Let the agent control iPhone 17 Pro Max (iOS 26.5)? Verify the gallery layout. Another chat will lose it.'

    // The desktop's one-line message folds device + reason into the question; on a phone
    // the title stays fixed and the specifics move to the body so the header never wraps.
    expect(permissionSheetPresentation(deviceRequest)).toMatchObject({
      title: 'Allow device control?',
      description: 'Verify the gallery layout. Another chat will lose it.',
      approveLabel: 'Allow',
      alwaysLabel: 'Always allow',
      denyLabel: 'Deny',
      items: [{ title: 'iPhone 17 Pro Max', subtitle: 'iOS 26.5', warning: true }],
    })
  })

  it('puts the terminal command in the item list and names the rule an always-allow stores', () => {
    const run = request('terminal_command_confirm')
    run.input = { action: 'run', command: 'bun run storybook --ci', cwd: '/Users/me/app', rule: 'bun run storybook( .*)?', description: 'Start Storybook to check the new story' }
    expect(permissionSheetPresentation(run)).toMatchObject({
      title: 'Run in a terminal tab?',
      description: 'Start Storybook to check the new story The agent controls the tab only while this command runs. Remembering keeps the rule bun run storybook( .*)? (a regular expression over the command) for this session or for this project.',
      alwaysLabel: 'Always allow',
      sessionLabel: 'Allow for session',
      items: [{ title: 'bun run storybook --ci', subtitle: '/Users/me/app' }],
    })

    const close = request('terminal_command_confirm')
    close.allowAlwaysAllow = false
    close.input = { action: 'close', command: 'zsh', cwd: '/Users/me/app', tab: 'Terminal 2' }
    expect(permissionSheetPresentation(close)).toMatchObject({ title: 'Close terminal tab?', alwaysLabel: undefined })
  })

  it('keeps approve labels to a single word so the footer buttons stay on one line', () => {
    const grantKinds = ['computer_use_grant', 'webmcp_trust_confirm', 'device_control_confirm', 'terminal_command_confirm'] as const
    for (const kind of grantKinds) {
      const presentation = permissionSheetPresentation(request(kind))
      expect(presentation.approveLabel, kind).toMatch(/^\w+$/)
      expect(presentation.alwaysLabel, kind).toMatch(/^Always \w+$/)
      // A selected remember choice becomes the approve label, so it is just as short.
      if (presentation.sessionLabel) expect(presentation.sessionLabel, kind).toMatch(/^\w+( \w+){0,2}$/)
    }
  })

  it('packs video and config defaults into the protocol fields', () => {
    const video = request('video_gen_confirm')
    video.videoGenConfirm = {
      params: { prompt: 'Orbit', provider: 'p', model: 'm', aspectRatio: '16:9', resolution: '720p', duration: 5, generateAudio: false, watermark: false, cameraFixed: false },
      providers: [],
      referenceImages: [],
    }
    expect(defaultPermissionFormAnswers(video)).toEqual({ paramsJson: JSON.stringify(video.videoGenConfirm.params) })

    const config = request('config_confirm')
    config.configConfirm = { fields: [{ key: 'theme', domain: 'app', label: 'Theme', type: 'enum', currentValue: 'dark', proposedValue: 'light' }] }
    expect(defaultPermissionFormAnswers(config)).toEqual({ configJson: '{"theme":"light"}' })
  })

  it('prefers the parsed schema form and maps a legacy field list onto it', () => {
    const legacy = request('mcp_elicitation')
    legacy.elicitationForm = [
      { name: 'scope', type: 'enum', label: 'Scope', required: true, enumOptions: ['repo', 'user'], defaultValue: 'repo' },
      { name: 'estimate', type: 'number', label: 'Estimate', required: false },
    ]
    expect(permissionSchemaForm(legacy)).toEqual({
      supported: true,
      fields: [
        { name: 'scope', label: 'Scope', required: true, kind: 'select', options: [{ value: 'repo', label: 'repo' }, { value: 'user', label: 'user' }], default: 'repo' },
        { name: 'estimate', label: 'Estimate', required: false, kind: 'number', integer: false },
      ],
    })
    const parsed = { ...legacy, schemaForm: { supported: false as const, reason: 'type "object"' } }
    expect(permissionSchemaForm(parsed)).toEqual(parsed.schemaForm)
    expect(permissionSchemaForm(request('mcp_elicitation'))).toBeUndefined()
  })

  it('presents selectable permission suggestions in human terms', () => {
    expect(permissionSuggestionLabel({ type: 'setMode', mode: 'acceptEdits' })).toBe('Switch to acceptEdits')
    expect(permissionSuggestionLabel({
      type: 'addDirectories',
      directories: ['/shared'],
      destination: 'projectSettings',
    })).toBe('Allow access to /shared for this project')
  })
})
