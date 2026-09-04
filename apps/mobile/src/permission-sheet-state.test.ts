import { describe, expect, it } from 'vitest'
import type { PermissionRequest } from '@superone/shared/agent-types'
import {
  defaultPermissionFormAnswers,
  elicitationAnswersAreValid,
  initialElicitationAnswers,
  permissionSheetPresentation,
} from './permission-sheet-state'

const kinds: NonNullable<PermissionRequest['requestKind']>[] = [
  'mcp_elicitation',
  'video_gen_confirm',
  'config_confirm',
  'session_agents_confirm',
  'computer_use_grant',
  'session_cleanup_confirm',
  'automation_confirm',
  'webmcp_trust_confirm',
]

function request(requestKind: NonNullable<PermissionRequest['requestKind']>): PermissionRequest {
  return { requestId: requestKind, requestKind, toolName: 'test_tool', input: {}, allowAlwaysAllow: true }
}

describe('permission sheet state', () => {
  it('has dedicated copy for every current request kind', () => {
    const titles = kinds.map((kind) => permissionSheetPresentation(request(kind)).title)
    expect(new Set(titles).size).toBe(kinds.length)
    expect(titles.every(Boolean)).toBe(true)
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
})
