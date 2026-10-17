/** Default Profiles follow live settings; saved Profile consent binds an exact reviewed configuration. */
import { isAgentProfilesEnabled } from './agent-profile-feature'
import { createHash } from 'crypto'
import type { SessionAgentLaunchConfig, SessionAgentLaunchProposal, SessionAgentProfile } from '@superone/shared/agent-types'
import { readAgentProfile } from '@superone/shared/agent-profile'
import { matchesProfileLaunchDefaults } from '@superone/shared/agent-profile-launch'
import { isDefaultSessionProvider } from '@superone/shared/session-provider-definitions'
import { canonicalJson } from '@superone/shared/request-coalescer'
import { getDb } from '../database'
import { readAppSettings } from '../app-settings-service'
import { resolveChatService } from '../providers/resolver'
import { getSessionProvider } from './session-provider-repo'
import { resolveAcpAgentId } from './agent-profiles'
import type { SessionProvider } from './types'

export { ensureAgentProfileApprovalSchema } from './agent-profile-approval-schema'

/** Stable equality for configuration objects (property order carries no authority). */
export function configFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalJson(value))).digest('hex')
}

type ApprovalProviderSnapshot = { display?: unknown; runtimeFingerprint: string; acpAgentId?: string | null }

/** Bind consent to the same merged endpoint/credentials the harness will use.
 * Secrets are hashed locally and never enter a confirmation payload or database.
 */
export function approvalProviderSnapshot(harnessId: SessionProvider['harnessId'], config: SessionAgentLaunchConfig, display?: unknown, acpAgentId?: string | null): ApprovalProviderSnapshot {
  const runtime = harnessId === 'claude' || harnessId === 'codex'
    ? resolveChatService(harnessId, config.apiProviderId, { experimentalClaudeOpenAiChatEnabled: readAppSettings().experimentalClaudeOpenAiChatEnabled })
    : null
  return { display, runtimeFingerprint: configFingerprint(runtime), ...(harnessId === 'acp' ? { acpAgentId: acpAgentId?.trim() || null } : {}) }
}

export function approvalFingerprint(row: SessionProvider, config: SessionAgentLaunchConfig, provider = approvalProviderSnapshot(row.harnessId, config, undefined, row.harnessId === 'acp' ? resolveAcpAgentId(row) : undefined)): string {
  return configFingerprint({ id: row.id, harnessId: row.harnessId, name: row.name, config: row.config, provider, launch: { permissionMode: 'default', sandboxMode: 'off', ...config } })
}

export function selectedApprovalProvider(profile: SessionAgentProfile) {
  return approvalProviderSnapshot(profile.harnessId, profile.defaultConfig, profile.apiProviders.find((provider) => provider.id === profile.defaultConfig.apiProviderId), profile.acpAgentId)
}

export function currentApprovalFingerprint(row: SessionProvider, profile: SessionAgentProfile): string {
  return approvalFingerprint(row, profile.defaultConfig, selectedApprovalProvider(profile))
}

export function approveAgentProfile(row: SessionProvider, config: SessionAgentLaunchConfig, provider?: ApprovalProviderSnapshot): void {
  if (row.isBase || !readAgentProfile(row.config)) throw new Error('Only a saved Profile can be preapproved.')
  getDb().prepare('INSERT INTO agent_profile_approvals (profile_id, fingerprint, approved_at) VALUES (?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET fingerprint = excluded.fingerprint, approved_at = excluded.approved_at')
    .run(row.id, approvalFingerprint(row, config, provider), Date.now())
}

export function isAgentProfileApproved(profile: SessionAgentProfile): boolean {
  if (!isAgentProfilesEnabled()) return false
  if (profile.harnessId === 'acp' && !profile.acpAgentId?.trim()) return false
  const row = getSessionProvider(profile.id)
  if (!row) return false
  if (isDefaultSessionProvider(row)) return true
  if (!profile.defaultConfig.model || row.isBase || !readAgentProfile(row.config)) return false
  const stored = getDb().prepare('SELECT fingerprint FROM agent_profile_approvals WHERE profile_id = ?').get(row.id) as { fingerprint: string } | undefined
  return !!stored && stored.fingerprint === currentApprovalFingerprint(row, profile)
}

/** Local same-project work at current defaults or a saved Profile's exact reviewed runtime. */
export function isPreapprovedProfileLaunch(profile: SessionAgentProfile, launch: SessionAgentLaunchProposal, cwd: string): boolean {
  return matchesProfileLaunchDefaults(launch, profile.defaultConfig, cwd) && isAgentProfileApproved(profile)
}
