/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import '@superone/shared/i18n'
import { AgentProfileConfirmPrompt } from './AgentProfileConfirmPrompt'

describe('persistent Profile collaboration consent', () => {
  it('shows the native read-only permission and enabled Codex sandbox', () => {
    const config = { model: 'gpt', permissionMode: 'default' as const, codexPermissionPreset: 'read-only' as const }
    render(<AgentProfileConfirmPrompt payload={{ operation: 'update', profiles: [{ id: 'reviewer', name: 'Reviewer', harnessId: 'codex', description: 'Reviews changes.' }], collaborationApproval: { baseConfig: config, config } }} onConfirm={vi.fn()} onReject={vi.fn()} />)
    expect(screen.getByText('Read-Only')).toBeInTheDocument()
    expect(screen.getByText('on')).toBeInTheDocument()
  })

  it('shows the exact account, sandbox and unchanged instructions when approving a legacy Profile', () => {
    const config = { model: 'gpt', permissionMode: 'default' as const, sandboxMode: 'on' as const, apiProviderId: 'codex-account:work' }
    render(<AgentProfileConfirmPrompt payload={{ operation: 'update', profiles: [{ id: 'implementer', name: 'Implementer', harnessId: 'codex', description: 'Implement scoped work.', instructions: 'Preserve unrelated changes.' }], changes: [], collaborationApproval: { baseConfig: config, config } }} onConfirm={vi.fn()} onReject={vi.fn()} />)
    expect(screen.getByText(/Allow future collaboration/)).toHaveTextContent('Delete the Profile to revoke approval')
    expect(screen.getByText('codex-account:work')).toBeInTheDocument()
    expect(screen.getByText('Preserve unrelated changes.')).toBeInTheDocument()
    expect(screen.getByText('Sandbox')).toBeInTheDocument()
  })
  it.each(['agent-before', undefined])('shows the effective ACP identity or unresolved boundary: %s', (acpAgentId) => {
    const config = { model: 'shared-model', permissionMode: 'default' as const }
    render(<AgentProfileConfirmPrompt payload={{ operation: 'update', profiles: [{ id: 'legacy', name: 'Legacy worker', harnessId: 'acp', acpAgentId, description: 'Implement tasks.' }], changes: [], collaborationApproval: { baseConfig: config, config } }} onConfirm={vi.fn()} onReject={vi.fn()} />)
    expect(screen.getByText('ACP Agent')).toBeInTheDocument()
    expect(screen.getByText(acpAgentId ?? 'Unresolved (Launch Approval Required)')).toBeInTheDocument()
  })
})
