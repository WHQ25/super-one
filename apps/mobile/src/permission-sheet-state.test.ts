import { describe, expect, it } from 'vitest'
import type { PermissionRequest } from '@superone/shared/agent-types'
import {
  defaultPermissionFormAnswers,
  elicitationAnswersAreValid,
  initialElicitationAnswers,
  permissionSuggestionLabel,
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

  it('keeps approve labels to a single word so the footer buttons stay on one line', () => {
    const grantKinds = ['computer_use_grant', 'webmcp_trust_confirm', 'device_control_confirm'] as const
    for (const kind of grantKinds) {
      const presentation = permissionSheetPresentation(request(kind))
      expect(presentation.approveLabel, kind).toMatch(/^\w+$/)
      expect(presentation.alwaysLabel, kind).toMatch(/^Always \w+$/)
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

  it('initializes and validates elicitation answers', () => {
    const fields = [
      { name: 'scope', type: 'enum' as const, label: 'Scope', required: true, enumOptions: ['repo', 'user'], defaultValue: 'repo' },
      { name: 'note', type: 'string' as const, label: 'Note', required: true },
    ]
    const answers = initialElicitationAnswers(fields)
    expect(answers).toEqual({ scope: 'repo', note: '' })
    expect(elicitationAnswersAreValid(fields, answers)).toBe(false)
    expect(elicitationAnswersAreValid(fields, { ...answers, note: 'ok' })).toBe(true)
  })

  it('rejects non-finite numeric fields and undeclared enum options', () => {
    const fields = [
      { name: 'estimate', label: 'Estimate', type: 'number' as const, required: true },
      { name: 'scope', label: 'Scope', type: 'enum' as const, required: true, enumOptions: ['session'] },
    ]
    expect(elicitationAnswersAreValid(fields, { estimate: '2.5', scope: 'session' })).toBe(true)
    expect(elicitationAnswersAreValid(fields, { estimate: 'NaN', scope: 'session' })).toBe(false)
    expect(elicitationAnswersAreValid(fields, { estimate: Infinity, scope: 'session' })).toBe(false)
    expect(elicitationAnswersAreValid(fields, { estimate: 2, scope: 'forever' })).toBe(false)
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
