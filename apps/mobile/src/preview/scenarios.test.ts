import { describe, expect, it } from 'vitest'
import { nativeScenarios } from './scenarios'
import { permissionExamples } from './permissions'
import { defaultPermissionFormAnswers, permissionSheetPresentation } from '../permission-sheet-state'

describe('native preview fixtures', () => {
  it('covers every permission kind and ordinary approval with unique scenario IDs', () => {
    expect(new Set(nativeScenarios.map((scenario) => scenario.id)).size).toBe(nativeScenarios.length)
    const permissions = nativeScenarios.filter((scenario) => scenario.category === 'Permissions')
    expect(permissions.some((scenario) => !scenario.request.requestKind)).toBe(true)
    const kinds = new Set(permissions.map((scenario) => scenario.request.requestKind).filter(Boolean))
    expect([...kinds].sort()).toEqual(Object.keys(permissionExamples).sort())
    for (const scenario of permissions) {
      expect(permissionSheetPresentation(scenario.request).title).toBeTruthy()
    }
  })

  it('uses populated payloads for destructive and structured approvals', () => {
    for (const scenario of nativeScenarios) {
      if (scenario.category !== 'Permissions') continue
      const request = scenario.request
      if (['video_gen_confirm', 'config_confirm', 'session_agents_confirm'].includes(request.requestKind ?? '')) {
        expect(defaultPermissionFormAnswers(request)).toBeDefined()
      }
      if (permissionSheetPresentation(request).destructive || request.requestKind === 'video_gen_confirm' || request.requestKind === 'session_agents_confirm') {
        expect(request.allowAlwaysAllow).toBe(false)
        expect(permissionSheetPresentation(request).alwaysLabel).toBeUndefined()
      }
    }
  })
})
