import { describe, expect, it } from 'vitest'
import { editablePermission, editedPermissionAnswers, patchLaunch, permissionEditsValid } from './permission-edit-state'
import { permissionRequest } from '../preview/permissions'
import { parseNativeDiff } from './diff-state'

describe('editable native confirmations', () => {
  it('submits changed video parameters and validates duration', () => {
    const request = permissionRequest('video_gen_confirm')
    request.videoGenConfirm = { ...request.videoGenConfirm!, params: { ...request.videoGenConfirm!.params, duration: 12, generateAudio: true } }
    expect(JSON.parse(editedPermissionAnswers(request)!.paramsJson as string)).toMatchObject({ duration: 12, generateAudio: true })
    request.videoGenConfirm.params.duration = NaN
    expect(permissionEditsValid(request)).toBe(false)
  })
  it('packs typed config edits and rejects values outside field constraints', () => {
    const request = permissionRequest('config_confirm')
    request.configConfirm = { fields: [{ key: 'limit', domain: 'app', label: 'Limit', type: 'number', min: 1, max: 10, currentValue: 2, proposedValue: 5 }], resource: { resource: 'env', operation: 'update', title: 'Environment', fields: [{ key: 'env', domain: 'provider', label: 'Environment', type: 'env', currentValue: {}, proposedValue: { TIMEOUT: '30' } }] } }
    expect(JSON.parse(editedPermissionAnswers(request)!.configJson as string)).toEqual({ limit: 5, env: { TIMEOUT: '30' } })
    request.configConfirm.fields![0].proposedValue = 11
    expect(permissionEditsValid(request)).toBe(false)
  })
  it('preserves collaboration mode, task and workspace while changing run tuning', () => {
    const original = permissionRequest('session_agents_confirm')
    const request = editablePermission(original)
    const launch = request.sessionAgentsConfirm!.launches[1]
    request.sessionAgentsConfirm!.launches[1] = patchLaunch(launch, { model: 'review-model', permissionMode: 'auto' })
    const result = JSON.parse(editedPermissionAnswers(request)!.sessionAgentLaunchesJson as string)
    expect(result[1]).toMatchObject({ mode: 'handoff', task: launch.task, config: { model: 'review-model', permissionMode: 'auto' } })
    expect(original.sessionAgentsConfirm!.launches[1].config.model).toBeUndefined()
  })
  it('sends automation overrides with consistent Codex aliases and no edits for delete', () => {
    const request = permissionRequest('automation_confirm')
    request.automationConfirm = { operation: 'update', items: [{ name: 'Review', enabled: false, agent: { type: 'codex', permissionMode: 'default' } }], changes: [{ field: 'agent', agentTo: { type: 'codex', permissionMode: 'auto', permissionPreset: 'default', effort: 'high' } }] }
    expect(editedPermissionAnswers(request)).toMatchObject({ enabled: false, agentConfig: { permissionMode: 'auto', permissionPreset: 'auto-review', effort: 'high', reasoningEffort: 'high' } })
    request.automationConfirm.operation = 'delete'
    expect(editedPermissionAnswers(request)).toBeUndefined()
  })
})

describe('native diff source alignment', () => {
  it('tracks separate hunk offsets and skips patch metadata', () => {
    const lines = parseNativeDiff('--- a/file\n+++ b/file\n@@ -10,2 +20,2 @@\n-old\n+new\n context\n@@ -90 +100 @@\n-last\n+next\n\\ No newline at end of file')
    expect(lines.map(({ line, text }) => [line, text])).toEqual([[10, 'old'], [20, 'new'], [21, 'context'], [90, 'last'], [100, 'next']])
  })
  it('consumes context on both token streams and preserves source beginning with dashes', () => {
    const lines = parseNativeDiff(' shared\n---value\n+++value\n tail', {
      removed: [[['shared', null]], [['--value', '#abcdef']], [['tail', null]]],
      added: [[['shared', null]], [['++value', '#fedcba']], [['tail', null]]],
    })
    expect(lines[1]).toMatchObject({ kind: 'removed', text: '--value', tokens: [['--value', '#abcdef']] })
    expect(lines[2]).toMatchObject({ kind: 'added', text: '++value', tokens: [['++value', '#fedcba']] })
    expect(lines[3]).toMatchObject({ line: 3, tokens: [['tail', null]] })
  })
  it('preserves patch-like source text inside hunks without adding trailing blank lines', () => {
    expect(parseNativeDiff('--- a/file\n+++ b/file\n@@ -1 +1 @@\n--- old\n+++ new\n').map(({ text }) => text)).toEqual(['-- old', '++ new'])
  })
  it('falls back to source text when supplied tokens do not match', () => {
    expect(parseNativeDiff('+new', { added: [[['old', '#abcdef']]] })[0].tokens).toBeUndefined()
  })
})
