import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildClaudeResultFailure, buildClaudeThrownFailure } from './result-failure'

describe('Claude startup diagnostics', () => {
  it('rechecks the internal hook compatibility wording when upgrading the SDK', () => {
    // This fallback matches internal SDK prose, not a stable error code.
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.dependencies['@anthropic-ai/claude-agent-sdk']).toBe('0.3.318')
  })

  it('keeps fail-closed runtime compatibility errors actionable without dropping the guard', () => {
    const raw = 'The process answering initialize does not honor onFailure on hook matchers, so a hook that fails would not block. Update Claude Code.'
    expect(buildClaudeThrownFailure(new Error(raw))).toMatchObject({ errorInfo: { code: 'runtime_upgrade_required', raw } })
    expect(buildClaudeThrownFailure(Object.assign(new Error('recover this file'), { startupFailureReason: 'config_file_invalid' })))
      .toMatchObject({ errorInfo: { startupFailureReason: 'config_file_invalid', raw: 'recover this file' } })
  })

  it.each([
    ['sandbox_required_unavailable', 'sandbox'],
    ['initialize_not_first', 'initialize'],
    ['config_file_invalid', 'configuration'],
  ])('explains %s and preserves the original recovery instructions', (reason, hint) => {
    const failure = buildClaudeResultFailure({ subtype: 'error_during_execution', startup_failure_reason: reason, errors: ['Restore /tmp/config from /tmp/backup'] })
    expect(failure.errorInfo).toMatchObject({ startupFailureReason: reason, raw: 'Restore /tmp/config from /tmp/backup' })
    expect(failure.error.toLowerCase()).toContain(hint)
    expect(failure.error).toContain('Restore /tmp/config from /tmp/backup')
  })

  it('keeps unknown future reasons without changing the generic error fallback', () => {
    expect(buildClaudeResultFailure({ subtype: 'error_during_execution', startup_failure_reason: 'future_reason', errors: ['upstream explanation'] }))
      .toMatchObject({ error: 'upstream explanation', errorInfo: { startupFailureReason: 'future_reason', raw: 'upstream explanation' } })
  })
})
