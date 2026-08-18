import { describe, expect, it } from 'vitest'
import {
  NODE_HARNESS_DEFINITIONS,
  buildHarnessDiagnostic,
  defaultHarnessInstallationStatus,
  isHarnessRunnable,
  isNodeHarnessId,
  nodeHarnessIdToSessionHarnessId,
  normalizeSessionHarnessId,
  readySessionHarnessIds,
  redactHarnessDiagnosticText,
  sanitizeHarnessCommand,
  sanitizeHarnessDiagnosticCode,
  sessionHarnessIdToNodeHarnessId,
  type HarnessInstallationStatus,
} from './harness-installation'

describe('NodeHarnessId', () => {
  it('accepts first-party catalog ids including cursor and acp-grok', () => {
    expect(isNodeHarnessId('claude')).toBe(true)
    expect(isNodeHarnessId('codex')).toBe(true)
    expect(isNodeHarnessId('opencode')).toBe(true)
    expect(isNodeHarnessId('cursor')).toBe(true)
    expect(isNodeHarnessId('acp-grok')).toBe(true)
    expect(isNodeHarnessId('dsh')).toBe(true)
    expect(isNodeHarnessId('deepseek')).toBe(false)
    expect(isNodeHarnessId('acp')).toBe(false)
    expect(isNodeHarnessId('unknown')).toBe(false)
  })

  it('maps legacy session acp to acp-grok and back to wire acp', () => {
    expect(sessionHarnessIdToNodeHarnessId('acp')).toBe('acp-grok')
    expect(sessionHarnessIdToNodeHarnessId('acp-grok')).toBe('acp-grok')
    expect(sessionHarnessIdToNodeHarnessId('cursor')).toBe('cursor')
    expect(sessionHarnessIdToNodeHarnessId('dsh')).toBe('dsh')
    expect(nodeHarnessIdToSessionHarnessId('acp-grok')).toBe('acp')
    expect(nodeHarnessIdToSessionHarnessId('codex')).toBe('codex')
    expect(nodeHarnessIdToSessionHarnessId('cursor')).toBe('cursor')
    expect(nodeHarnessIdToSessionHarnessId('dsh')).toBe('dsh')
  })

  it('normalizes session wire ids so Grok always persists as acp in Stage 1', () => {
    expect(normalizeSessionHarnessId('acp-grok')).toBe('acp')
    expect(normalizeSessionHarnessId('acp')).toBe('acp')
    expect(normalizeSessionHarnessId('codex')).toBe('codex')
    expect(normalizeSessionHarnessId('cursor')).toBe('cursor')
    expect(normalizeSessionHarnessId('dsh')).toBe('dsh')
    expect(normalizeSessionHarnessId('unknown')).toBeNull()
  })
})

describe('diagnostic allowlist and defense-in-depth redaction', () => {
  it('builds messages only from authored templates', () => {
    expect(buildHarnessDiagnostic('probe_failed').message).toBe('readiness probe failed')
    expect(buildHarnessDiagnostic('needs_auth').message).toContain('authentication')
    expect(
      buildHarnessDiagnostic('incompatible', {
        expectedVersion: '1.2.3',
        actualVersion: '0.9.0',
      }).message,
    ).toContain('expected 1.2.3')
  })

  it('rejects free-form secret-like values even as defense-in-depth input', () => {
    const cases = [
      'OPENAI_API_KEY=sk-review-secret',
      'Authorization: Basic dXNlcjpwYXNz',
      'password="super secret"',
    ]
    for (const input of cases) {
      const out = redactHarnessDiagnosticText(input)
      expect(out).not.toContain('sk-review-secret')
      expect(out).not.toContain('dXNlcjpwYXNz')
      expect(out).not.toContain('super secret')
    }
  })

  it('rejects non-absolute and control-character commands', () => {
    expect(sanitizeHarnessCommand('/usr/bin/grok')).toBe('/usr/bin/grok')
    expect(sanitizeHarnessCommand('grok')).toBeUndefined()
    expect(sanitizeHarnessCommand('/bin/x\ny')).toBeUndefined()
    expect(sanitizeHarnessDiagnosticCode('probe_failed')).toBe('probe_failed')
    expect(sanitizeHarnessDiagnosticCode('not_a_real_code')).toBe('error')
    expect(sanitizeHarnessDiagnosticCode('BAD CODE!')).toBe('error')
  })
})

describe('readySessionHarnessIds', () => {
  it('returns empty when nothing is enabled+ready', () => {
    const statuses = NODE_HARNESS_DEFINITIONS.map((d) => defaultHarnessInstallationStatus(d.id))
    expect(readySessionHarnessIds(statuses)).toEqual([])
  })

  it('advertises only enabled ready harnesses using session wire ids', () => {
    const statuses: HarnessInstallationStatus[] = [
      { ...defaultHarnessInstallationStatus('claude'), enabled: true, state: 'ready' },
      { ...defaultHarnessInstallationStatus('codex'), enabled: true, state: 'needs_auth' },
      { ...defaultHarnessInstallationStatus('opencode'), enabled: false, state: 'ready' },
      {
        ...defaultHarnessInstallationStatus('acp-grok'),
        enabled: true,
        state: 'ready',
        command: '/usr/local/bin/grok',
      },
    ]
    expect(readySessionHarnessIds(statuses)).toEqual(['claude', 'acp'])
  })

  it('isHarnessRunnable requires both enabled and ready', () => {
    expect(isHarnessRunnable({ enabled: true, state: 'ready' })).toBe(true)
    expect(isHarnessRunnable({ enabled: true, state: 'needs_auth' })).toBe(false)
    expect(isHarnessRunnable({ enabled: false, state: 'ready' })).toBe(false)
    expect(isHarnessRunnable({ enabled: true, state: 'disabled' })).toBe(false)
  })
})

describe('defaultHarnessInstallationStatus', () => {
  it('starts disabled without leaking secrets', () => {
    for (const def of NODE_HARNESS_DEFINITIONS) {
      const status = defaultHarnessInstallationStatus(def.id)
      expect(status.enabled).toBe(false)
      expect(status.state).toBe('disabled')
      expect(status.runtimeSource).toBe(def.runtimeSource)
      expect(status.requiresAuth).toBe(def.requiresAuth)
      expect(status).not.toHaveProperty('env')
      expect(status).not.toHaveProperty('password')
      expect(status).not.toHaveProperty('token')
    }
  })
})
